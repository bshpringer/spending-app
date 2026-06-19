import type { Database } from "better-sqlite3";
import type { PlaidStagingRemovalRow, PlaidStagingRemovalAction } from "../types.ts";

export interface NewRemovalInput {
  itemId: string;
  plaidTransactionId: string;
  matchedTransactionId: string;
  matchedDate: string;
  matchedName: string;
  matchedAmount: number;
  replacementHint?: string | null;
}

export function makePlaidStagingRemovalsRepo(db: Database) {
  // proposedAction defaults: 'delete' when we have a replacementHint pointing
  // at a likely posted version (the local row is genuinely superseded), else
  // 'ignore' (no signal the charge was actually canceled — preserving the
  // local row is safer than erasing real spend). The dangerous case where a
  // removal + fuzzy-duplicate both target the same local row is handled
  // upstream by the linker's Pass 2 (splices the removal out entirely), so
  // removals that reach this point with a hint are safe to default-delete.
  const insert = db.prepare(`
    INSERT INTO plaid_staging_removals (
      itemId, plaidTransactionId, matchedTransactionId,
      matchedDate, matchedName, matchedAmount,
      proposedAction, replacementHint, createdAt
    ) VALUES (
      @itemId, @plaidTransactionId, @matchedTransactionId,
      @matchedDate, @matchedName, @matchedAmount,
      @proposedAction, @replacementHint, @createdAt
    )
    ON CONFLICT(itemId, plaidTransactionId) DO NOTHING
  `);
  const selectByItem = db.prepare(
    `SELECT * FROM plaid_staging_removals WHERE itemId = ? ORDER BY matchedDate DESC`,
  );
  const countByItem = db.prepare(
    `SELECT itemId, COUNT(*) AS n FROM plaid_staging_removals GROUP BY itemId`,
  );
  const deleteByItem = db.prepare(`DELETE FROM plaid_staging_removals WHERE itemId = ?`);
  const updateAction = db.prepare(
    `UPDATE plaid_staging_removals SET proposedAction = ? WHERE itemId = ? AND plaidTransactionId = ?`,
  );

  function insertBatch(rows: NewRemovalInput[]): number {
    const now = new Date().toISOString();
    let n = 0;
    const tx = db.transaction((items: NewRemovalInput[]) => {
      for (const r of items) {
        const hint = r.replacementHint ?? null;
        const info = insert.run({
          ...r,
          replacementHint: hint,
          proposedAction: hint ? "delete" : "ignore",
          createdAt: now,
        });
        if (info.changes > 0) n++;
      }
    });
    tx(rows);
    return n;
  }

  function listByItem(itemId: string): PlaidStagingRemovalRow[] {
    return selectByItem.all(itemId) as PlaidStagingRemovalRow[];
  }

  function countsByItem(): Map<string, number> {
    const rows = countByItem.all() as { itemId: string; n: number }[];
    return new Map(rows.map((r) => [r.itemId, r.n]));
  }

  function deleteBatch(itemId: string): void {
    deleteByItem.run(itemId);
  }

  function setAction(
    itemId: string,
    plaidTransactionId: string,
    action: PlaidStagingRemovalAction,
  ): void {
    updateAction.run(action, itemId, plaidTransactionId);
  }

  return { insertBatch, listByItem, countsByItem, deleteBatch, setAction };
}

export type PlaidStagingRemovalsRepo = ReturnType<typeof makePlaidStagingRemovalsRepo>;
