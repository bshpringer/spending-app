import type { AccountBase, Transaction as PlaidTransaction } from "plaid";
import { getPlaidClient } from "./client.ts";
import { mapPlaidTransaction } from "./mapPlaidTransaction.ts";
import type { ParsedTransaction } from "../types.ts";

export interface PlaidAccountContext {
  institutionName: string;
  accountNumberLast4: string;
}

export interface SyncResult {
  added: ParsedTransaction[];
  removedPlaidTransactionIds: string[];
  nextCursor: string;
  // True if Plaid returned has_more=false and we made it to the end of the page chain.
  complete: boolean;
}

/**
 * Pull every page from /transactions/sync until `has_more` is false. Maps each
 * added/modified Plaid transaction onto a ParsedTransaction using the supplied
 * per-Plaid-account context (institutionName + last4). Modified transactions are
 * treated identically to added — bulkUpsert will dedupe on plaidTransactionId
 * and silently skip rows that already exist (v1 doesn't re-edit existing rows).
 *
 * No date-range filtering happens here — callers apply windowing *after* the
 * pending→posted linker has had a chance to see the full add set, otherwise
 * an out-of-window posted row silently drops its in-window pending counterpart
 * from auto-resolution.
 */
export async function pullTransactionsSync(args: {
  accessToken: string;
  cursor: string | null;
  contextByPlaidAccountId: Map<string, PlaidAccountContext>;
}): Promise<SyncResult> {
  const client = getPlaidClient();
  const added: ParsedTransaction[] = [];
  const removed: string[] = [];
  let cursor = args.cursor ?? undefined;
  let hasMore = true;
  let lastCursor = args.cursor ?? "";

  while (hasMore) {
    const resp = await client.transactionsSync({
      access_token: args.accessToken,
      cursor,
      options: { include_original_description: true },
    });
    const data = resp.data;
    for (const txn of [...data.added, ...data.modified]) {
      const ctx = args.contextByPlaidAccountId.get(txn.account_id);
      if (!ctx) {
        // Plaid returned a sub-account we don't have linked locally (user
        // skipped it at reconciliation, or it's brand-new). Skip silently —
        // a future re-reconcile pass can pick these up.
        continue;
      }
      added.push(mapPlaidTransaction(txn as PlaidTransaction, ctx));
    }
    for (const r of data.removed) {
      if (r.transaction_id) removed.push(r.transaction_id);
    }
    lastCursor = data.next_cursor;
    cursor = data.next_cursor;
    hasMore = data.has_more;
  }

  return {
    added,
    removedPlaidTransactionIds: removed,
    nextCursor: lastCursor,
    complete: true,
  };
}

/**
 * Fetch the list of accounts for an Item. Used at reconciliation time so the
 * UI can prompt the user for each Plaid sub-account.
 */
export async function fetchAccounts(accessToken: string): Promise<AccountBase[]> {
  const client = getPlaidClient();
  const resp = await client.accountsGet({ access_token: accessToken });
  return resp.data.accounts;
}
