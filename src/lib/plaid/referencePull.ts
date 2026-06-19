import type { Transaction as PlaidTransaction } from "plaid";
import type { TransactionPlaidRaw } from "../types.ts";
import { getPlaidClient } from "./client.ts";
import { extractPlaidRaw } from "./mapPlaidTransaction.ts";

export interface ReferenceTxn {
  plaidTransactionId: string;
  plaidAccountId: string;
  date: string;
  originalDate: string;
  name: string;
  merchantName: string | null;
  amount: number; // accounting sign (negative = expense)
  csvAmount: number; // raw Plaid sign (positive = money out)
  category: string;
  description: string;
  // Same rich-payload capture as the /sync path (mapPlaidTransaction). Without
  // these, backfilled rows reach the review screen with no raw detail — the
  // hover card is empty and the category-overwrite highlight can't recover
  // Plaid's original category (it reads plaidRawFull).
  plaidRaw: TransactionPlaidRaw;
  plaidRawFull: string;
}

function titleCase(s: string): string {
  if (!s) return "";
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function mapForReference(txn: PlaidTransaction): ReferenceTxn {
  const merchantName = txn.merchant_name?.trim() || null;
  const name = merchantName && merchantName.length > 0 ? merchantName : txn.name;
  const description = txn.original_description?.trim() ?? "";
  const category = titleCase(
    txn.personal_finance_category?.primary?.replace(/_/g, " ").toLowerCase() ?? "",
  );
  const originalDate = txn.authorized_date ?? txn.date;
  const csvAmount = txn.amount;
  return {
    plaidTransactionId: txn.transaction_id,
    plaidAccountId: txn.account_id,
    date: txn.date,
    originalDate,
    name,
    merchantName,
    amount: -csvAmount,
    csvAmount,
    category,
    description,
    plaidRaw: extractPlaidRaw(txn),
    plaidRawFull: JSON.stringify(txn),
  };
}

function isoDaysAgo(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Paginate /transactions/get over a window. Unlike /transactions/sync this
 * does NOT touch the item's cursor and is safe to call any number of times.
 * Used by the Phase 2 reconciliation reference pull.
 */
export async function pullReferenceWindow(args: {
  accessToken: string;
  months: number;
}): Promise<ReferenceTxn[]> {
  const client = getPlaidClient();
  const startDate = isoDaysAgo(args.months);
  const endDate = today();

  const collected: ReferenceTxn[] = [];
  const PAGE = 500;
  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const resp = await client.transactionsGet({
      access_token: args.accessToken,
      start_date: startDate,
      end_date: endDate,
      options: { count: PAGE, offset },
    });
    const data = resp.data;
    for (const txn of data.transactions) {
      collected.push(mapForReference(txn as PlaidTransaction));
    }
    total = data.total_transactions;
    offset += data.transactions.length;
    if (data.transactions.length === 0) break;
  }

  return collected;
}

/**
 * Backfill pull. Like `pullReferenceWindow` but takes an explicit ISO date
 * window and filters out pending transactions (their Plaid ids are unstable —
 * they get replaced by posted-row ids and would re-fire on the next sync). The
 * item's cursor is NOT touched. Used by `/api/plaid/historical-import` to
 * surface historical rows for the review screen.
 */
export async function pullHistoricalWindow(args: {
  accessToken: string;
  startDate: string;
  endDate: string;
  /** Optional Plaid sub-account scope. If provided + non-empty, only these
   *  sub-accounts are queried (Plaid `options.account_ids`). Omit to pull all
   *  linked sub-accounts on the Item. */
  accountIds?: string[];
}): Promise<ReferenceTxn[]> {
  const client = getPlaidClient();

  const collected: ReferenceTxn[] = [];
  const PAGE = 500;
  let offset = 0;
  let total = Infinity;
  const scoped = args.accountIds && args.accountIds.length > 0;

  while (offset < total) {
    const resp = await client.transactionsGet({
      access_token: args.accessToken,
      start_date: args.startDate,
      end_date: args.endDate,
      options: {
        count: PAGE,
        offset,
        include_personal_finance_category: true,
        // Plaid omits original_description unless explicitly requested. Without
        // this, every pulled row's `description` is blank — breaking the
        // reconcile matcher's desc-exact tier and the side-by-side diff. The
        // /sync path passes the same flag.
        include_original_description: true,
        ...(scoped ? { account_ids: args.accountIds } : {}),
      },
    });
    const data = resp.data;
    for (const txn of data.transactions) {
      if (txn.pending) continue;
      collected.push(mapForReference(txn as PlaidTransaction));
    }
    total = data.total_transactions;
    offset += data.transactions.length;
    if (data.transactions.length === 0) break;
  }

  return collected;
}
