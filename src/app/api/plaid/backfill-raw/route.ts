import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db.ts";
import { makePlaidItemRepo } from "@/lib/repo/plaidItemRepo.ts";
import { getPlaidClient } from "@/lib/plaid/client.ts";
import type { Transaction as PlaidTransaction } from "plaid";

export const dynamic = "force-dynamic";

interface PerItemSummary {
  itemId: string;
  institutionName: string | null;
  scanned: number;
  backfilled: number;
  notFoundInPlaid: number;
  /** Rows still NULL after the pull — Plaid didn't return them in the window. */
  remaining: number;
  error?: string;
}

/**
 * One-shot backfill of `transactions.plaidRawFull` for existing Plaid-sourced
 * rows that pre-date the going-forward capture in `mapPlaidTransaction`.
 *
 * Strategy per Plaid item:
 *   1. Find the date window from MIN(originalDate)..MAX(date) of this item's
 *      transactions where plaidRawFull IS NULL.
 *   2. Page through /transactions/get over that window (cursor untouched).
 *   3. For each returned txn, UPDATE the row whose plaidTransactionId matches,
 *      writing the verbatim JSON.stringify(txn) into plaidRawFull. Guarded by
 *      `WHERE plaidRawFull IS NULL` so reruns are idempotent.
 *
 * Costs a few API calls per item; well under any reasonable limit. Rows
 * whose transaction_id has been superseded by Plaid (rare) won't be
 * recoverable — surfaced as `remaining` > 0 with the corresponding count
 * in `notFoundInPlaid` left at 0 (Plaid simply didn't return them).
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { itemId?: string };

    const db = getDb();
    const itemRepo = makePlaidItemRepo(db);
    const items = body.itemId
      ? itemRepo.list().filter((i) => i.itemId === body.itemId)
      : itemRepo.list();

    if (items.length === 0) {
      return NextResponse.json({ error: "no_items" }, { status: 404 });
    }

    const updateRaw = db.prepare(
      `UPDATE transactions
         SET plaidRawFull = ?
       WHERE plaidTransactionId = ?
         AND plaidRawFull IS NULL`,
    );

    const summaries: PerItemSummary[] = [];

    for (const item of items) {
      const summary: PerItemSummary = {
        itemId: item.itemId,
        institutionName: item.institutionName,
        scanned: 0,
        backfilled: 0,
        notFoundInPlaid: 0,
        remaining: 0,
      };

      // Plaid sub-accounts linked to local accounts for this item.
      const subAccountRows = db
        .prepare(
          `SELECT pa.plaidAccountId, pa.accountId
             FROM plaid_accounts pa
            WHERE pa.itemId = ?`,
        )
        .all(item.itemId) as { plaidAccountId: string; accountId: string }[];
      const localAccountIds = subAccountRows.map((r) => r.accountId);
      if (localAccountIds.length === 0) {
        summaries.push(summary);
        continue;
      }

      // Window: only rows that still need backfilling.
      const window = db
        .prepare(
          `SELECT MIN(COALESCE(NULLIF(t.originalDate, ''), t.date)) AS minDate,
                  MAX(t.date) AS maxDate,
                  COUNT(*) AS pending
             FROM transactions t
            WHERE t.source = 'plaid'
              AND t.plaidRawFull IS NULL
              AND t.accountId IN (${localAccountIds.map(() => "?").join(",")})`,
        )
        .get(...localAccountIds) as { minDate: string | null; maxDate: string | null; pending: number };

      if (window.pending === 0 || !window.minDate || !window.maxDate) {
        summaries.push(summary);
        continue;
      }

      // Pull the window from Plaid, scoped to this item's sub-accounts.
      const accessToken = itemRepo.getAccessToken(item.itemId);
      if (!accessToken) {
        summary.error = "no_access_token";
        summaries.push(summary);
        continue;
      }

      const plaidAccountIds = subAccountRows.map((r) => r.plaidAccountId);

      try {
        const client = getPlaidClient();
        const PAGE = 500;
        let offset = 0;
        let total = Infinity;
        const tx = db.transaction((batch: PlaidTransaction[]) => {
          for (const t of batch) {
            summary.scanned += 1;
            const info = updateRaw.run(JSON.stringify(t), t.transaction_id);
            if (info.changes > 0) summary.backfilled += 1;
          }
        });

        while (offset < total) {
          const resp = await client.transactionsGet({
            access_token: accessToken,
            start_date: window.minDate,
            end_date: window.maxDate,
            options: {
              count: PAGE,
              offset,
              include_personal_finance_category: true,
              include_original_description: true,
              account_ids: plaidAccountIds,
            },
          });
          const data = resp.data;
          tx(data.transactions as PlaidTransaction[]);
          total = data.total_transactions;
          offset += data.transactions.length;
          if (data.transactions.length === 0) break;
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        summary.error = msg;
        summaries.push(summary);
        continue;
      }

      // Recompute remaining after the pull.
      const after = db
        .prepare(
          `SELECT COUNT(*) AS n
             FROM transactions t
            WHERE t.source = 'plaid'
              AND t.plaidRawFull IS NULL
              AND t.accountId IN (${localAccountIds.map(() => "?").join(",")})`,
        )
        .get(...localAccountIds) as { n: number };
      summary.remaining = after.n;

      summaries.push(summary);
    }

    revalidatePath("/settings/plaid");

    return NextResponse.json({ summaries });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
