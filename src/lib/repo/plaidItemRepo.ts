import type { Database } from "better-sqlite3";
import type { PlaidItem, PlaidAccountLink } from "../types.ts";

interface PlaidItemRow {
  itemId: string;
  accessToken: string;
  institutionId: string | null;
  institutionName: string | null;
  cursor: string | null;
  pendingCursor: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PlaidAccountRow {
  plaidAccountId: string;
  itemId: string;
  accountId: string;
  createdAt: string;
}

function rowToItem(row: PlaidItemRow): PlaidItem {
  return {
    itemId: row.itemId,
    institutionId: row.institutionId,
    institutionName: row.institutionName,
    cursor: row.cursor,
    pendingCursor: row.pendingCursor,
    lastSyncedAt: row.lastSyncedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function makePlaidItemRepo(db: Database) {
  const insertItem = db.prepare(
    `INSERT INTO plaid_items (itemId, accessToken, institutionId, institutionName, cursor, lastSyncedAt, createdAt, updatedAt)
     VALUES (@itemId, @accessToken, @institutionId, @institutionName, NULL, NULL, @createdAt, @updatedAt)`,
  );
  const selectItem = db.prepare(`SELECT * FROM plaid_items WHERE itemId = ?`);
  const selectAllItems = db.prepare(
    `SELECT * FROM plaid_items ORDER BY COALESCE(sortOrder, 1e9) ASC, createdAt ASC`,
  );
  const setSortOrderStmt = db.prepare(
    `UPDATE plaid_items SET sortOrder = ?, updatedAt = ? WHERE itemId = ?`,
  );
  const updateCursor = db.prepare(
    `UPDATE plaid_items SET cursor = ?, lastSyncedAt = ?, updatedAt = ? WHERE itemId = ?`,
  );
  const setPendingCursor = db.prepare(
    `UPDATE plaid_items SET pendingCursor = ?, updatedAt = ? WHERE itemId = ?`,
  );
  // Promotes pendingCursor → cursor when one was parked (normal sync commit).
  // When pendingCursor IS NULL (historical-import batch with no parked cursor),
  // preserve the existing cursor + lastSyncedAt so the next /sync still picks
  // up from where it left off. updatedAt + the NULL no-op on pendingCursor are
  // safe to write unconditionally.
  const commitPendingCursor = db.prepare(
    `UPDATE plaid_items
        SET cursor = COALESCE(pendingCursor, cursor),
            lastSyncedAt = CASE WHEN pendingCursor IS NOT NULL THEN ? ELSE lastSyncedAt END,
            pendingCursor = NULL,
            updatedAt = ?
      WHERE itemId = ?`,
  );
  const clearPendingCursor = db.prepare(
    `UPDATE plaid_items SET pendingCursor = NULL, updatedAt = ? WHERE itemId = ?`,
  );
  const deleteItem = db.prepare(`DELETE FROM plaid_items WHERE itemId = ?`);

  const insertAccountLink = db.prepare(
    `INSERT INTO plaid_accounts (plaidAccountId, itemId, accountId, createdAt)
     VALUES (?, ?, ?, ?)`,
  );
  const selectAccountLinksByItem = db.prepare(
    `SELECT * FROM plaid_accounts WHERE itemId = ?`,
  );
  const selectAccountIdByPlaid = db.prepare(
    `SELECT accountId FROM plaid_accounts WHERE plaidAccountId = ?`,
  );
  // Earliest Plaid-sourced transaction date per Item. Useful as a proxy for how
  // far back a given Item's historical window reaches — if the earliest known
  // tx is 2026-03-08, /transactions/get won't return anything older than that
  // until the Item is relinked with a wider days_requested.
  const selectEarliestPlaidDateByItem = db.prepare(
    `SELECT pa.itemId AS itemId, MIN(t.date) AS earliest
       FROM plaid_accounts pa
       JOIN transactions t ON t.accountId = pa.accountId
      WHERE t.source = 'plaid'
      GROUP BY pa.itemId`,
  );

  return {
    create(input: {
      itemId: string;
      accessToken: string;
      institutionId: string | null;
      institutionName: string | null;
    }): PlaidItem {
      const now = new Date().toISOString();
      insertItem.run({
        itemId: input.itemId,
        accessToken: input.accessToken,
        institutionId: input.institutionId,
        institutionName: input.institutionName,
        createdAt: now,
        updatedAt: now,
      });
      const row = selectItem.get(input.itemId) as PlaidItemRow;
      return rowToItem(row);
    },
    getByItemId(itemId: string): PlaidItem | null {
      const row = selectItem.get(itemId) as PlaidItemRow | undefined;
      return row ? rowToItem(row) : null;
    },
    getAccessToken(itemId: string): string | null {
      const row = selectItem.get(itemId) as PlaidItemRow | undefined;
      return row?.accessToken ?? null;
    },
    list(): PlaidItem[] {
      const rows = selectAllItems.all() as PlaidItemRow[];
      return rows.map(rowToItem);
    },
    updateCursor(itemId: string, cursor: string): void {
      const now = new Date().toISOString();
      updateCursor.run(cursor, now, now, itemId);
    },
    setPendingCursor(itemId: string, cursor: string): void {
      setPendingCursor.run(cursor, new Date().toISOString(), itemId);
    },
    /** Promotes pendingCursor → cursor atomically, stamps lastSyncedAt. */
    commitPendingCursor(itemId: string): void {
      const now = new Date().toISOString();
      commitPendingCursor.run(now, now, itemId);
    },
    clearPendingCursor(itemId: string): void {
      clearPendingCursor.run(new Date().toISOString(), itemId);
    },
    delete(itemId: string): void {
      deleteItem.run(itemId);
    },
    linkAccount(input: {
      plaidAccountId: string;
      itemId: string;
      accountId: string;
    }): void {
      insertAccountLink.run(
        input.plaidAccountId,
        input.itemId,
        input.accountId,
        new Date().toISOString(),
      );
    },
    accountLinksByItem(itemId: string): PlaidAccountLink[] {
      return selectAccountLinksByItem.all(itemId) as PlaidAccountRow[];
    },
    resolveAccountId(plaidAccountId: string): string | null {
      const row = selectAccountIdByPlaid.get(plaidAccountId) as { accountId: string } | undefined;
      return row?.accountId ?? null;
    },
    reorder(orderedItemIds: string[]): void {
      const now = new Date().toISOString();
      const txn = db.transaction((ids: string[]) => {
        ids.forEach((id, idx) => setSortOrderStmt.run(idx, now, id));
      });
      txn(orderedItemIds);
    },
    earliestPlaidDateByItem(): Map<string, string> {
      const rows = selectEarliestPlaidDateByItem.all() as { itemId: string; earliest: string | null }[];
      const map = new Map<string, string>();
      for (const r of rows) if (r.earliest) map.set(r.itemId, r.earliest);
      return map;
    },
  };
}

export type PlaidItemRepo = ReturnType<typeof makePlaidItemRepo>;
