import type { Database } from "better-sqlite3";

export interface DuplicateReviewRow {
  txAId: string;
  txBId: string;
  status: "kept";
  createdAt: string;
}

/** Canonical key: txAId, txBId in lex order so each unordered pair has one row. */
export function duplicatePairKey(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export function makeDuplicateReviewRepo(db: Database) {
  const selectAll = db.prepare(
    `SELECT txAId, txBId, status, createdAt FROM duplicate_reviews`,
  );
  const upsertKept = db.prepare(
    `INSERT INTO duplicate_reviews (txAId, txBId, status, createdAt)
     VALUES (?, ?, 'kept', ?)
     ON CONFLICT(txAId, txBId) DO UPDATE SET createdAt = excluded.createdAt`,
  );
  const del = db.prepare(`DELETE FROM duplicate_reviews WHERE txAId = ? AND txBId = ?`);

  return {
    list(): DuplicateReviewRow[] {
      return selectAll.all() as DuplicateReviewRow[];
    },
    keptPairKeys(): Set<string> {
      const rows = selectAll.all() as DuplicateReviewRow[];
      return new Set(rows.map((r) => `${r.txAId}|${r.txBId}`));
    },
    markKept(a: string, b: string): void {
      const [x, y] = duplicatePairKey(a, b);
      upsertKept.run(x, y, new Date().toISOString());
    },
    unmark(a: string, b: string): void {
      const [x, y] = duplicatePairKey(a, b);
      del.run(x, y);
    },
  };
}

export type DuplicateReviewRepo = ReturnType<typeof makeDuplicateReviewRepo>;
