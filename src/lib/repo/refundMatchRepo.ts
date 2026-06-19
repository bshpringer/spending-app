import type { Database } from "better-sqlite3";

export type RefundMatchStatus = "confirmed" | "rejected";

export interface RefundMatchRow {
  expenseId: string;
  refundId: string;
  status: RefundMatchStatus;
  createdAt: string;
}

function pairKey(expenseId: string, refundId: string): string {
  return `${expenseId}|${refundId}`;
}

export function makeRefundMatchRepo(db: Database) {
  const selectAll = db.prepare(
    `SELECT expenseId, refundId, status, createdAt FROM refund_matches`,
  );
  const selectByStatus = db.prepare(
    `SELECT expenseId, refundId, status, createdAt FROM refund_matches WHERE status = ?`,
  );
  const selectForTx = db.prepare(
    `SELECT expenseId, refundId, status, createdAt
     FROM refund_matches
     WHERE status = 'confirmed' AND (expenseId = ? OR refundId = ?)`,
  );
  const upsert = db.prepare(
    `INSERT INTO refund_matches (expenseId, refundId, status, createdAt)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(expenseId, refundId) DO UPDATE SET
       status = excluded.status,
       createdAt = excluded.createdAt`,
  );
  const del = db.prepare(`DELETE FROM refund_matches WHERE expenseId = ? AND refundId = ?`);

  return {
    listMatches(): RefundMatchRow[] {
      return selectAll.all() as RefundMatchRow[];
    },
    listByStatus(status: RefundMatchStatus): RefundMatchRow[] {
      return selectByStatus.all(status) as RefundMatchRow[];
    },
    /** All confirmed pairs as plain { expenseId, refundId } objects — for refund netting. */
    allConfirmedPairs(): { expenseId: string; refundId: string }[] {
      return (selectByStatus.all("confirmed") as RefundMatchRow[]).map((r) => ({
        expenseId: r.expenseId,
        refundId: r.refundId,
      }));
    },
    confirmedPairKeys(): Set<string> {
      const rows = selectByStatus.all("confirmed") as RefundMatchRow[];
      return new Set(rows.map((r) => pairKey(r.expenseId, r.refundId)));
    },
    rejectedPairKeys(): Set<string> {
      const rows = selectByStatus.all("rejected") as RefundMatchRow[];
      return new Set(rows.map((r) => pairKey(r.expenseId, r.refundId)));
    },
    linksForTransaction(txId: string): RefundMatchRow[] {
      return selectForTx.all(txId, txId) as RefundMatchRow[];
    },
    confirm(expenseId: string, refundId: string): void {
      upsert.run(expenseId, refundId, "confirmed", new Date().toISOString());
    },
    reject(expenseId: string, refundId: string): void {
      upsert.run(expenseId, refundId, "rejected", new Date().toISOString());
    },
    unlink(expenseId: string, refundId: string): void {
      del.run(expenseId, refundId);
    },
  };
}

export type RefundMatchRepo = ReturnType<typeof makeRefundMatchRepo>;
