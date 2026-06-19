import type { Database } from "better-sqlite3";
import { reconcilePairKey } from "../reconcile.ts";

export type ReconciliationStatus = "reconciled" | "rejected";

export interface ReconciliationReviewRow {
  csvTransactionId: string;
  plaidTransactionId: string;
  status: ReconciliationStatus;
  createdAt: string;
}

/**
 * Persisted user decisions for the /reconcile page. Mirrors `refund_matches`:
 * only decided pairs are stored; "suggested" pairs are recomputed fresh per load
 * by `detectReconciliations` and filtered against `reviewedPairKeys()`.
 *
 * The CSV side is a real `transactions.id`; the Plaid side is the raw
 * `plaidTransactionId` (re-pull-stable, not necessarily a committed row). Keys
 * use `reconcilePairKey(csvId, plaidTransactionId)` so they interoperate with
 * the matcher's `reviewedPairs` argument — the caller maps each staged Plaid row
 * to a `Transaction` whose `id` is its `plaidTransactionId`.
 */
export function makeReconciliationReviewRepo(db: Database) {
  const selectAll = db.prepare(
    `SELECT csvTransactionId, plaidTransactionId, status, createdAt FROM reconciliation_reviews`,
  );
  const upsert = db.prepare(
    `INSERT INTO reconciliation_reviews (csvTransactionId, plaidTransactionId, status, createdAt)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(csvTransactionId, plaidTransactionId)
       DO UPDATE SET status = excluded.status, createdAt = excluded.createdAt`,
  );
  const del = db.prepare(
    `DELETE FROM reconciliation_reviews WHERE csvTransactionId = ? AND plaidTransactionId = ?`,
  );

  function mark(csvId: string, plaidTransactionId: string, status: ReconciliationStatus): void {
    upsert.run(csvId, plaidTransactionId, status, new Date().toISOString());
  }

  return {
    list(): ReconciliationReviewRow[] {
      return selectAll.all() as ReconciliationReviewRow[];
    },
    /** Union of both statuses — every pair the user has already decided. Passed
     *  to `detectReconciliations` to suppress re-suggesting either outcome. */
    reviewedPairKeys(): Set<string> {
      const rows = selectAll.all() as ReconciliationReviewRow[];
      return new Set(rows.map((r) => reconcilePairKey(r.csvTransactionId, r.plaidTransactionId)));
    },
    markReconciled(csvId: string, plaidTransactionId: string): void {
      mark(csvId, plaidTransactionId, "reconciled");
    },
    markRejected(csvId: string, plaidTransactionId: string): void {
      mark(csvId, plaidTransactionId, "rejected");
    },
    /** Remove a decision (Restore) — the pair becomes eligible to suggest again. */
    unmark(csvId: string, plaidTransactionId: string): void {
      del.run(csvId, plaidTransactionId);
    },
  };
}

export type ReconciliationReviewRepo = ReturnType<typeof makeReconciliationReviewRepo>;
