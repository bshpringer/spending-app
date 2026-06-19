import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import type {
  PlaidStagingRow,
  PlaidStagingAction,
  PlaidStagingMode,
  TransactionPlaidRaw,
  TransactionUserOverrides,
} from "../types.ts";

interface StagingRow {
  stagingId: string;
  itemId: string;
  plaidTransactionId: string;
  accountId: string | null;
  profileId: string | null;
  dedupeKey: string;
  date: string;
  originalDate: string;
  name: string;
  customName: string | null;
  canonicalName: string | null;
  amount: number;
  csvAmount: number;
  description: string;
  category: string;
  note: string;
  tags: string;
  proposedAction: PlaidStagingAction;
  matchedTransactionId: string | null;
  flagReason: string | null;
  mode: PlaidStagingMode;
  prefilledFromMediumAlias: number;
  plaidRaw: string | null;
  plaidRawFull: string | null;
  replacesTransactionId: string | null;
  inheritedOverrides: string | null;
  createdAt: string;
  updatedAt: string;
}

function parsePlaidRaw(raw: string | null): TransactionPlaidRaw | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TransactionPlaidRaw;
  } catch {
    return null;
  }
}

function rowToStaging(row: StagingRow): PlaidStagingRow {
  let tags: string[] = [];
  try {
    const parsed = JSON.parse(row.tags) as unknown;
    if (Array.isArray(parsed)) tags = parsed.filter((t): t is string => typeof t === "string");
  } catch {
    // malformed — treat as empty
  }
  return {
    stagingId: row.stagingId,
    itemId: row.itemId,
    plaidTransactionId: row.plaidTransactionId,
    accountId: row.accountId,
    profileId: row.profileId,
    dedupeKey: row.dedupeKey,
    date: row.date,
    originalDate: row.originalDate,
    name: row.name,
    customName: row.customName,
    canonicalName: row.canonicalName,
    amount: row.amount,
    csvAmount: row.csvAmount,
    description: row.description,
    category: row.category,
    note: row.note,
    tags,
    proposedAction: row.proposedAction,
    matchedTransactionId: row.matchedTransactionId,
    flagReason: row.flagReason,
    mode: row.mode,
    prefilledFromMediumAlias: row.prefilledFromMediumAlias === 1,
    plaidRaw: parsePlaidRaw(row.plaidRaw),
    plaidRawFull: row.plaidRawFull,
    replacesTransactionId: row.replacesTransactionId,
    inheritedOverrides: parseOverrides(row.inheritedOverrides),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function parseOverrides(raw: string | null): TransactionUserOverrides | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TransactionUserOverrides;
  } catch {
    return null;
  }
}

export interface NewStagingInput {
  itemId: string;
  plaidTransactionId: string;
  accountId: string | null;
  profileId: string | null;
  dedupeKey: string;
  date: string;
  originalDate: string;
  name: string;
  customName?: string | null;
  canonicalName?: string | null;
  amount: number;
  csvAmount: number;
  description?: string;
  category?: string;
  note?: string;
  tags?: string[];
  proposedAction?: PlaidStagingAction;
  matchedTransactionId?: string | null;
  flagReason?: string | null;
  mode?: PlaidStagingMode;
  prefilledFromMediumAlias?: boolean;
  plaidRaw?: TransactionPlaidRaw | null;
  plaidRawFull?: string | null;
  replacesTransactionId?: string | null;
  inheritedOverrides?: TransactionUserOverrides | null;
}

export interface StagingUpdateInput {
  date?: string;
  originalDate?: string;
  amount?: number;
  customName?: string | null;
  canonicalName?: string | null;
  category?: string;
  note?: string;
  tags?: string[];
  proposedAction?: PlaidStagingAction;
  matchedTransactionId?: string | null;
}

export function makePlaidStagingRepo(db: Database) {
  const insert = db.prepare(`
    INSERT INTO plaid_staging (
      stagingId, itemId, plaidTransactionId, accountId, profileId, dedupeKey,
      date, originalDate, name, customName, canonicalName, amount, csvAmount,
      description, category, note, tags, proposedAction, matchedTransactionId,
      flagReason, mode, prefilledFromMediumAlias, plaidRaw, plaidRawFull,
      replacesTransactionId, inheritedOverrides, createdAt, updatedAt
    ) VALUES (
      @stagingId, @itemId, @plaidTransactionId, @accountId, @profileId, @dedupeKey,
      @date, @originalDate, @name, @customName, @canonicalName, @amount, @csvAmount,
      @description, @category, @note, @tags, @proposedAction, @matchedTransactionId,
      @flagReason, @mode, @prefilledFromMediumAlias, @plaidRaw, @plaidRawFull,
      @replacesTransactionId, @inheritedOverrides, @createdAt, @updatedAt
    )
    ON CONFLICT(itemId, plaidTransactionId, mode) DO NOTHING
  `);
  // All "commit-mode" reads explicitly filter mode='commit' so reference-pull
  // rows (used only by the reconciliation wizard) never leak into the
  // staging-review / commit flow.
  const selectByItem = db.prepare(
    `SELECT * FROM plaid_staging WHERE itemId = ? AND mode = 'commit' ORDER BY date DESC, createdAt ASC`,
  );
  const selectById = db.prepare(`SELECT * FROM plaid_staging WHERE stagingId = ?`);
  const countByItem = db.prepare(
    `SELECT itemId, COUNT(*) AS n FROM plaid_staging WHERE mode = 'commit' GROUP BY itemId`,
  );
  const deleteByItem = db.prepare(`DELETE FROM plaid_staging WHERE itemId = ? AND mode = 'commit'`);

  // Reference-mode statements (Phase 2 reconciliation). These deliberately do
  // not interact with the commit lifecycle.
  const selectReferenceByItem = db.prepare(
    `SELECT * FROM plaid_staging WHERE itemId = ? AND mode = 'reference' ORDER BY date DESC, createdAt ASC`,
  );
  const selectAllReference = db.prepare(
    `SELECT * FROM plaid_staging WHERE mode = 'reference' ORDER BY date DESC, createdAt ASC`,
  );
  const countReferenceByItem = db.prepare(
    `SELECT itemId, COUNT(*) AS n FROM plaid_staging WHERE mode = 'reference' GROUP BY itemId`,
  );
  const deleteReferenceByItem = db.prepare(
    `DELETE FROM plaid_staging WHERE itemId = ? AND mode = 'reference'`,
  );
  const deleteAllReference = db.prepare(`DELETE FROM plaid_staging WHERE mode = 'reference'`);

  function insertBatch(rows: NewStagingInput[]): number {
    const now = new Date().toISOString();
    let inserted = 0;
    const tx = db.transaction((items: NewStagingInput[]) => {
      for (const r of items) {
        const info = insert.run({
          stagingId: randomUUID(),
          itemId: r.itemId,
          plaidTransactionId: r.plaidTransactionId,
          accountId: r.accountId,
          profileId: r.profileId,
          dedupeKey: r.dedupeKey,
          date: r.date,
          originalDate: r.originalDate,
          name: r.name,
          customName: r.customName ?? null,
          canonicalName: r.canonicalName ?? null,
          amount: r.amount,
          csvAmount: r.csvAmount,
          description: r.description ?? "",
          category: r.category ?? "",
          note: r.note ?? "",
          tags: JSON.stringify(r.tags ?? []),
          proposedAction: r.proposedAction ?? "keep",
          matchedTransactionId: r.matchedTransactionId ?? null,
          flagReason: r.flagReason ?? null,
          mode: r.mode ?? "commit",
          prefilledFromMediumAlias: r.prefilledFromMediumAlias ? 1 : 0,
          plaidRaw: r.plaidRaw ? JSON.stringify(r.plaidRaw) : null,
          plaidRawFull: r.plaidRawFull ?? null,
          replacesTransactionId: r.replacesTransactionId ?? null,
          inheritedOverrides: r.inheritedOverrides ? JSON.stringify(r.inheritedOverrides) : null,
          createdAt: now,
          updatedAt: now,
        });
        if (info.changes > 0) inserted++;
      }
    });
    tx(rows);
    return inserted;
  }

  function listByItem(itemId: string): PlaidStagingRow[] {
    const rows = selectByItem.all(itemId) as StagingRow[];
    return rows.map(rowToStaging);
  }

  function getById(stagingId: string): PlaidStagingRow | null {
    const row = selectById.get(stagingId) as StagingRow | null;
    return row ? rowToStaging(row) : null;
  }

  function countsByItem(): Map<string, number> {
    const rows = countByItem.all() as { itemId: string; n: number }[];
    return new Map(rows.map((r) => [r.itemId, r.n]));
  }

  function deleteBatch(itemId: string): void {
    deleteByItem.run(itemId);
  }

  function update(stagingId: string, input: StagingUpdateInput): void {
    const existing = selectById.get(stagingId) as StagingRow | null;
    if (!existing) throw new Error(`staging row ${stagingId} not found`);
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE plaid_staging
      SET date = @date,
          originalDate = @originalDate,
          amount = @amount,
          customName = @customName,
          canonicalName = @canonicalName,
          category = @category,
          note = @note,
          tags = @tags,
          proposedAction = @proposedAction,
          matchedTransactionId = @matchedTransactionId,
          updatedAt = @updatedAt
      WHERE stagingId = @stagingId
    `).run({
      stagingId,
      date: input.date ?? existing.date,
      originalDate: input.originalDate ?? existing.originalDate,
      amount: input.amount ?? existing.amount,
      customName: "customName" in input ? (input.customName ?? null) : existing.customName,
      canonicalName: "canonicalName" in input ? (input.canonicalName ?? null) : existing.canonicalName,
      category: input.category ?? existing.category,
      note: input.note ?? existing.note,
      tags: input.tags ? JSON.stringify(input.tags) : existing.tags,
      proposedAction: input.proposedAction ?? existing.proposedAction,
      matchedTransactionId:
        "matchedTransactionId" in input
          ? (input.matchedTransactionId ?? null)
          : existing.matchedTransactionId,
      updatedAt: now,
    });
  }

  function listReference(itemId?: string): PlaidStagingRow[] {
    const rows = (itemId
      ? selectReferenceByItem.all(itemId)
      : selectAllReference.all()) as StagingRow[];
    return rows.map(rowToStaging);
  }

  function referenceCountsByItem(): Map<string, number> {
    const rows = countReferenceByItem.all() as { itemId: string; n: number }[];
    return new Map(rows.map((r) => [r.itemId, r.n]));
  }

  function clearReference(itemId?: string): void {
    if (itemId) deleteReferenceByItem.run(itemId);
    else deleteAllReference.run();
  }

  return {
    insertBatch,
    listByItem,
    getById,
    countsByItem,
    deleteBatch,
    update,
    listReference,
    referenceCountsByItem,
    clearReference,
  };
}

export type PlaidStagingRepo = ReturnType<typeof makePlaidStagingRepo>;
