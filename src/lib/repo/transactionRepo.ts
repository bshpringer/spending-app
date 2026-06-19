import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import type {
  ParsedTransaction,
  Transaction,
  TransactionPlaidRaw,
  TransactionUserOverrides,
  MonthlyTotal,
  CategoryTotal,
  TagTotal,
} from "../types.ts";
import { slugify } from "./tagRepo.ts";
import { DEFAULT_PROFILE_ID } from "../constants.ts";

interface TransactionRow {
  id: string;
  dedupeKey: string;
  accountId: string | null;
  profileId: string | null;
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
  ignoredFrom: string;
  taxDeductible: number;
  userOverrides: string;
  importedFromCsvAt: string;
  importBatchId: string | null;
  source: string;
  plaidRaw: string | null;
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

function rowToTransaction(row: TransactionRow, tags: string[]): Transaction {
  return {
    id: row.id,
    dedupeKey: row.dedupeKey,
    accountId: row.accountId,
    profileId: row.profileId ?? DEFAULT_PROFILE_ID,
    date: row.date,
    originalDate: row.originalDate,
    name: row.name,
    customName: row.customName ?? undefined,
    canonicalName: row.canonicalName ?? undefined,
    amount: row.amount,
    csvAmount: row.csvAmount,
    description: row.description,
    category: row.category,
    note: row.note,
    ignoredFrom: row.ignoredFrom,
    taxDeductible: row.taxDeductible === 1,
    tags,
    userOverrides: JSON.parse(row.userOverrides) as TransactionUserOverrides,
    importedFromCsvAt: row.importedFromCsvAt,
    importBatchId: row.importBatchId,
    source: row.source,
    plaidRaw: parsePlaidRaw(row.plaidRaw),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface TransactionUpdateInput {
  category?: string;
  customName?: string | null;
  canonicalName?: string | null;
  note?: string;
  excluded?: boolean;
  oneTime?: boolean;
  tags?: string[];
  date?: string;
  originalDate?: string;
  amount?: number;
  profileId?: string;
}

export interface BulkUpsertResult {
  newCount: number;
  matchedCount: number;
  newIds: string[];
}

export interface TransactionFilters {
  search?: string;
  tagIds?: string[];
  accountIds?: string[];
  categories?: string[];
  profileIds?: string[];
  from?: string;
  to?: string;
  sort?: "date" | "amount" | "name" | "category";
  dir?: "asc" | "desc";
  excludedFilter?: "all" | "hide" | "only"; // default "all"
  oneTimeFilter?: "all" | "hide" | "only"; // default "all"
  canonicalFilter?: "all" | "missing" | "present"; // default "all" — missing = unreconciled (no canonicalName)
  source?: "csv" | "plaid" | "manual"; // exact match on transactions.source
  importBatchId?: string;
  merchant?: string; // matches COALESCE(canonicalName, customName, name) exactly
  // Amount filter. Signed comparison on t.amount (negative=expense,
  // positive=income/refund). `between` clamps to [min(value, max), max(...)].
  amountOp?: "gt" | "lt" | "eq" | "between";
  amountValue?: number;
  amountMax?: number;
  /**
   * Opt out of the global "data start date" floor (see prefsRepo). Use for
   * internal paths that must see the full history regardless of the user's
   * configured start date — e.g. reverse-ledger balance walks. User-facing
   * reads leave this unset so they honor the floor.
   */
  ignoreGlobalFloor?: boolean;
}

export interface ManualTransactionInput {
  date: string;
  name: string;
  amount: number;
  accountId?: string | null;
  profileId: string;
  category?: string;
  note?: string;
  tags?: string[];
  customName?: string | null;
  excluded?: boolean;
  oneTime?: boolean;
}

export function makeTransactionRepo(db: Database) {
  // Global "data start date" floor (prefsRepo). Read once per repo instance —
  // a repo is created per request, so this stays fresh without re-reading meta
  // on every query. Empty/missing → no floor. Applied in buildWhereClauses to
  // every read query unless the caller passes `ignoreGlobalFloor`.
  const dataStartFloor = (() => {
    const row = db
      .prepare(`SELECT value FROM meta WHERE key = 'pref_data_start_date'`)
      .get() as { value: string } | undefined;
    return row?.value || null;
  })();

  const selectByDedupeKey = db.prepare(`SELECT id FROM transactions WHERE dedupeKey = ?`);
  const selectByPlaidId = db.prepare(`SELECT id FROM transactions WHERE plaidTransactionId = ?`);
  const insert = db.prepare(
    `INSERT INTO transactions
     (id, dedupeKey, accountId, profileId, date, originalDate, name, customName, canonicalName,
      amount, csvAmount, description, category, note, ignoredFrom, taxDeductible, userOverrides,
      importedFromCsvAt, importBatchId, source, plaidTransactionId, plaidRaw, plaidRawFull, createdAt, updatedAt)
     VALUES
     (@id, @dedupeKey, @accountId, @profileId, @date, @originalDate, @name, @customName, @canonicalName,
      @amount, @csvAmount, @description, @category, @note, @ignoredFrom, @taxDeductible, @userOverrides,
      @importedAt, @importBatchId, @source, @plaidTransactionId, @plaidRaw, @plaidRawFull, @importedAt, @importedAt)`,
  );
  const deleteTx = db.prepare(`DELETE FROM transactions WHERE id = ?`);
  const insertTxTag = db.prepare(
    `INSERT OR IGNORE INTO transaction_tags (transactionId, tagId) VALUES (?, ?)`,
  );
  const ensureTagExists = db.prepare(
    `INSERT OR IGNORE INTO tags (id, displayName, createdAt) VALUES (?, ?, ?)`,
  );
  const selectAll = db.prepare(`SELECT * FROM transactions ORDER BY date DESC, createdAt DESC`);
  const selectTagsForTx = db.prepare(
    `SELECT tagId FROM transaction_tags WHERE transactionId = ?`,
  );

  /**
   * Insert new transactions; skip any whose dedupeKey already exists.
   * userOverrides are trivially preserved by never touching existing rows.
   * Caller must resolve `accountNaturalKey` → `accountId` before calling.
   */
  function bulkUpsert(
    parsed: ParsedTransaction[],
    accountIdByNaturalKey: Map<string, string>,
    profileIdByAccountId: Map<string, string> = new Map(),
    importBatchId: string | null = null,
    options: {
      skipDedupeKeys?: Set<string>;
      overridesByDedupeKey?: Map<string, TransactionUserOverrides>;
      profileIdByDedupeKey?: Map<string, string>;
      source?: string;
    } = {},
  ): BulkUpsertResult {
    const result: BulkUpsertResult = { newCount: 0, matchedCount: 0, newIds: [] };
    const importedAt = new Date().toISOString();
    const skip = options.skipDedupeKeys ?? new Set<string>();
    const overrides = options.overridesByDedupeKey ?? new Map<string, TransactionUserOverrides>();
    const profileOverride = options.profileIdByDedupeKey ?? new Map<string, string>();
    const source = options.source ?? "csv";

    const tx = db.transaction((rows: ParsedTransaction[]) => {
      for (const row of rows) {
        if (skip.has(row.dedupeKey)) continue;
        const accountId = accountIdByNaturalKey.get(row.accountNaturalKey);
        if (!accountId) {
          throw new Error(`no accountId for naturalKey ${row.accountNaturalKey}`);
        }
        const profileId = profileOverride.get(row.dedupeKey) ?? profileIdByAccountId.get(accountId) ?? DEFAULT_PROFILE_ID;

        // Plaid rows dedupe on transaction_id first — the same Plaid row can
        // come back across syncs (modified) and we never want to double-insert.
        if (row.plaidTransactionId && selectByPlaidId.get(row.plaidTransactionId)) {
          result.matchedCount++;
          continue;
        }
        if (selectByDedupeKey.get(row.dedupeKey)) {
          result.matchedCount++;
          continue;
        }

        const ov = overrides.get(row.dedupeKey);
        const persistedOverrides: TransactionUserOverrides = {};
        if (ov?.excluded) persistedOverrides.excluded = true;
        if (ov?.oneTime) persistedOverrides.oneTime = true;
        if (ov?.customName) persistedOverrides.customName = ov.customName;
        if (ov?.category !== undefined && ov.category !== row.category) persistedOverrides.category = ov.category;
        if (ov?.note !== undefined && ov.note !== row.note) persistedOverrides.note = ov.note;
        if (ov?.tags) persistedOverrides.tags = ov.tags;

        const effectiveCategory = ov?.category ?? row.category;
        const effectiveNote = ov?.note ?? row.note;
        const effectiveCustomName = ov?.customName ?? null;
        const effectiveTags = ov?.tags ?? row.tags;

        const id = randomUUID();
        insert.run({
          id,
          dedupeKey: row.dedupeKey,
          accountId,
          profileId,
          date: row.date,
          originalDate: row.originalDate,
          name: row.name,
          customName: effectiveCustomName,
          canonicalName: row.canonicalName ?? null,
          amount: row.amount,
          csvAmount: row.csvAmount,
          description: row.description,
          category: effectiveCategory,
          note: effectiveNote,
          ignoredFrom: row.ignoredFrom,
          taxDeductible: row.taxDeductible ? 1 : 0,
          userOverrides: JSON.stringify(persistedOverrides),
          importedAt,
          importBatchId,
          source,
          plaidTransactionId: row.plaidTransactionId ?? null,
          plaidRaw: row.plaidRaw ? JSON.stringify(row.plaidRaw) : null,
          plaidRawFull: row.plaidRawFull ?? null,
        });

        for (const tagDisplay of effectiveTags) {
          const tagId = slugify(tagDisplay);
          if (!tagId) continue;
          ensureTagExists.run(tagId, tagDisplay, importedAt);
          insertTxTag.run(id, tagId);
        }

        result.newCount++;
        result.newIds.push(id);
      }
    });

    tx(parsed);
    return result;
  }

  function createManual(input: ManualTransactionInput): string {
    const id = randomUUID();
    const now = new Date().toISOString();
    const dedupeKey = `manual:${id}`;
    const txFn = db.transaction(() => {
      const overrides: TransactionUserOverrides = {};
      if (input.excluded) overrides.excluded = true;
      if (input.oneTime) overrides.oneTime = true;
      if (input.customName) overrides.customName = input.customName;
      insert.run({
        id,
        dedupeKey,
        accountId: input.accountId ?? null,
        profileId: input.profileId,
        date: input.date,
        originalDate: input.date,
        name: input.name,
        customName: input.customName ?? null,
        canonicalName: null,
        amount: input.amount,
        csvAmount: -input.amount,
        description: "",
        category: input.category ?? "",
        note: input.note ?? "",
        ignoredFrom: "",
        taxDeductible: 0,
        userOverrides: JSON.stringify(overrides),
        importedAt: now,
        importBatchId: null,
        source: "manual",
        plaidTransactionId: null,
        plaidRaw: null,
        plaidRawFull: null,
      });
      for (const tagId of input.tags ?? []) {
        if (!tagId) continue;
        insertTxTag.run(id, tagId);
      }
    });
    txFn();
    return id;
  }

  function deleteTransaction(id: string): void {
    deleteTx.run(id);
  }

  function list(): Transaction[] {
    const rows = selectAll.all() as TransactionRow[];
    return rows.map((row) => {
      const tags = (selectTagsForTx.all(row.id) as { tagId: string }[]).map((r) => r.tagId);
      return rowToTransaction(row, tags);
    });
  }

  // Shared WHERE-clause builder for query() and any sibling queries (e.g. the
  // distinct-categories chip helper) that need to honor the same filter shape.
  function buildWhereClauses(filters: TransactionFilters): { clauses: string[]; params: unknown[] } {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (filters.search && filters.search.trim()) {
      const like = `%${filters.search.trim().toLowerCase()}%`;
      clauses.push(
        `(LOWER(t.name) LIKE ? OR LOWER(IFNULL(t.customName,'')) LIKE ? OR LOWER(IFNULL(t.canonicalName,'')) LIKE ? OR LOWER(t.description) LIKE ? OR LOWER(t.category) LIKE ? OR LOWER(t.note) LIKE ?)`,
      );
      params.push(like, like, like, like, like, like);
    }

    if (filters.accountIds && filters.accountIds.length > 0) {
      clauses.push(`t.accountId IN (${filters.accountIds.map(() => "?").join(",")})`);
      params.push(...filters.accountIds);
    }

    if (filters.categories && filters.categories.length > 0) {
      clauses.push(`t.category IN (${filters.categories.map(() => "?").join(",")})`);
      params.push(...filters.categories);
    }

    // Filter on the canonical "aggregation date" — the swipe/authorized date
    // (originalDate) when available, falling back to the posted date. Keeps
    // filter / sort / display / aggregation all keyed off the same notion of
    // when the money actually moved.
    if (filters.from) {
      clauses.push(`COALESCE(NULLIF(t.originalDate, ''), t.date) >= ?`);
      params.push(filters.from);
    }
    if (filters.to) {
      clauses.push(`COALESCE(NULLIF(t.originalDate, ''), t.date) <= ?`);
      params.push(filters.to);
    }

    // Global data-start-date floor: an additional `>=` lower bound applied to
    // every read so the app behaves as if no data exists before the configured
    // date. ANDs with any explicit `filters.from` above — since both are lower
    // bounds the later one wins, so a page can narrow further but can't reach
    // below the floor. Opt out with `ignoreGlobalFloor` for full-history reads.
    if (dataStartFloor && !filters.ignoreGlobalFloor) {
      clauses.push(`COALESCE(NULLIF(t.originalDate, ''), t.date) >= ?`);
      params.push(dataStartFloor);
    }

    if (filters.importBatchId) {
      clauses.push(`t.importBatchId = ?`);
      params.push(filters.importBatchId);
    }

    if (filters.merchant) {
      clauses.push(`COALESCE(NULLIF(t.canonicalName, ''), NULLIF(t.customName, ''), t.name) = ?`);
      params.push(filters.merchant);
    }

    if (filters.profileIds && filters.profileIds.length > 0) {
      clauses.push(`t.profileId IN (${filters.profileIds.map(() => "?").join(",")})`);
      params.push(...filters.profileIds);
    }

    if (filters.excludedFilter === "hide") {
      clauses.push(`(COALESCE(json_extract(t.userOverrides, '$.excluded'), 0) != 1 AND COALESCE((SELECT classification FROM categories c WHERE c.displayName = t.category), '') != 'ignored')`);
    } else if (filters.excludedFilter === "only") {
      clauses.push(`(json_extract(t.userOverrides, '$.excluded') = 1 OR (SELECT classification FROM categories c WHERE c.displayName = t.category) = 'ignored')`);
    }

    if (filters.oneTimeFilter === "hide") {
      clauses.push(`COALESCE(json_extract(t.userOverrides, '$.oneTime'), 0) != 1`);
    } else if (filters.oneTimeFilter === "only") {
      clauses.push(`json_extract(t.userOverrides, '$.oneTime') = 1`);
    }

    if (filters.canonicalFilter === "missing") {
      clauses.push(`(t.canonicalName IS NULL OR t.canonicalName = '')`);
    } else if (filters.canonicalFilter === "present") {
      clauses.push(`(t.canonicalName IS NOT NULL AND t.canonicalName != '')`);
    }

    if (filters.source) {
      clauses.push(`t.source = ?`);
      params.push(filters.source);
    }

    if (filters.tagIds && filters.tagIds.length > 0) {
      const placeholders = filters.tagIds.map(() => "?").join(",");
      clauses.push(
        `(EXISTS (SELECT 1 FROM transaction_tags tt WHERE tt.transactionId = t.id AND tt.tagId IN (${placeholders}))
          OR EXISTS (SELECT 1 FROM account_tags atg WHERE atg.accountId = t.accountId AND atg.tagId IN (${placeholders})))`,
      );
      params.push(...filters.tagIds, ...filters.tagIds);
    }

    if (filters.amountOp === "gt" && filters.amountValue != null) {
      clauses.push(`t.amount > ?`);
      params.push(filters.amountValue);
    } else if (filters.amountOp === "lt" && filters.amountValue != null) {
      clauses.push(`t.amount < ?`);
      params.push(filters.amountValue);
    } else if (filters.amountOp === "eq" && filters.amountValue != null) {
      clauses.push(`t.amount = ?`);
      params.push(filters.amountValue);
    } else if (filters.amountOp === "between" && filters.amountValue != null && filters.amountMax != null) {
      const lo = Math.min(filters.amountValue, filters.amountMax);
      const hi = Math.max(filters.amountValue, filters.amountMax);
      clauses.push(`t.amount BETWEEN ? AND ?`);
      params.push(lo, hi);
    }

    return { clauses, params };
  }

  function query(filters: TransactionFilters): Transaction[] {
    const { clauses, params } = buildWhereClauses(filters);
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const SORT_COL: Record<string, string> = {
      date: "COALESCE(NULLIF(t.originalDate, ''), t.date)",
      amount: "t.amount",
      name: "LOWER(COALESCE(NULLIF(t.customName, ''), NULLIF(t.canonicalName, ''), t.name))",
      category: "LOWER(t.category)",
    };
    const sortCol = SORT_COL[filters.sort ?? "date"] ?? SORT_COL.date;
    const sortDir = filters.dir === "asc" ? "ASC" : "DESC";
    const sql = `SELECT t.* FROM transactions t ${where} ORDER BY ${sortCol} ${sortDir}, t.createdAt DESC`;
    const rows = db.prepare(sql).all(...params) as TransactionRow[];
    return rows.map((row) => {
      const tags = (selectTagsForTx.all(row.id) as { tagId: string }[]).map((r) => r.tagId);
      return rowToTransaction(row, tags);
    });
  }

  /**
   * Slim helper for the categories filter chip list: returns only the
   * distinct non-empty `category` values among transactions matching the
   * given filters. Cheap — no tag joins, no row mapping. Tombstoned
   * categories are excluded (mirrors `categoriesWithTransactions`).
   */
  function distinctCategoriesMatching(filters: TransactionFilters): string[] {
    const { clauses, params } = buildWhereClauses(filters);
    const guard = [
      ...clauses,
      `t.category <> ''`,
      `t.category NOT IN (SELECT displayName FROM deleted_categories)`,
    ];
    const where = `WHERE ${guard.join(" AND ")}`;
    const sql = `SELECT DISTINCT t.category FROM transactions t ${where} ORDER BY t.category`;
    return (db.prepare(sql).all(...params) as { category: string }[]).map((r) => r.category);
  }

  const selectById = db.prepare(`SELECT * FROM transactions WHERE id = ?`);
  const updateTxRow = db.prepare(`
    UPDATE transactions
    SET category = @category, customName = @customName, canonicalName = @canonicalName, note = @note,
        userOverrides = @userOverrides, updatedAt = @updatedAt,
        date = @date, originalDate = @originalDate, amount = @amount, profileId = @profileId
    WHERE id = @id
  `);
  const deleteTxTags = db.prepare(`DELETE FROM transaction_tags WHERE transactionId = ?`);

  function updateTransaction(id: string, input: TransactionUpdateInput): void {
    const existingRow = selectById.get(id) as TransactionRow | null;
    if (!existingRow) throw new Error(`Transaction ${id} not found`);

    const existing = JSON.parse(existingRow.userOverrides) as TransactionUserOverrides;
    const overrides: TransactionUserOverrides = { ...existing };

    if (input.category !== undefined) overrides.category = input.category;
    if ("customName" in input) overrides.customName = input.customName ?? undefined;
    if (input.note !== undefined) overrides.note = input.note;
    if (input.excluded !== undefined) {
      if (input.excluded) overrides.excluded = true;
      else delete overrides.excluded;
    }
    if (input.oneTime !== undefined) {
      if (input.oneTime) overrides.oneTime = true;
      else delete overrides.oneTime;
    }

    const updatedAt = new Date().toISOString();

    const txFn = db.transaction(() => {
      updateTxRow.run({
        id,
        category: input.category ?? existingRow.category,
        customName: "customName" in input ? (input.customName ?? null) : existingRow.customName,
        canonicalName: "canonicalName" in input ? (input.canonicalName ?? null) : existingRow.canonicalName,
        note: input.note ?? existingRow.note,
        userOverrides: JSON.stringify(overrides),
        updatedAt,
        // `date` is the posted/settled day (Plaid `date`, CSV `Date`) and is
        // treated as immutable audit-trail post-creation. The edit modal only
        // touches `originalDate` (the swipe day / canonical aggregation date).
        date: input.date ?? existingRow.date,
        originalDate: input.originalDate ?? existingRow.originalDate,
        amount: input.amount ?? existingRow.amount,
        profileId: input.profileId ?? existingRow.profileId ?? DEFAULT_PROFILE_ID,
      });

      if (input.tags !== undefined) {
        deleteTxTags.run(id);
        for (const tagId of input.tags) {
          insertTxTag.run(id, tagId);
        }
      }
    });

    txFn();
  }

  function getById(id: string): Transaction | null {
    const row = selectById.get(id) as TransactionRow | null;
    if (!row) return null;
    const tags = (selectTagsForTx.all(id) as { tagId: string }[]).map((r) => r.tagId);
    return rowToTransaction(row, tags);
  }

  /**
   * Batch fetch multiple transactions by id. Returns only the rows that exist.
   * Used to pre-load out-of-window expense rows for refund netting.
   */
  function getByIds(ids: string[]): Transaction[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(",");
    const rows = db.prepare(`SELECT * FROM transactions WHERE id IN (${placeholders})`).all(...ids) as TransactionRow[];
    return rows.map((row) => {
      const tags = (selectTagsForTx.all(row.id) as { tagId: string }[]).map((r) => r.tagId);
      return rowToTransaction(row, tags);
    });
  }

  /**
   * Categories that have at least one transaction. Distinct from
   * `distinctCategories()`, which unions in the `categories` table so empty
   * categories show up. Used for filter chips where empty chips are noise.
   */
  function categoriesWithTransactions(): string[] {
    const rows = db
      .prepare(
        `SELECT DISTINCT category FROM transactions
         WHERE category <> ''
           AND category NOT IN (SELECT displayName FROM deleted_categories)
         ORDER BY category`,
      )
      .all() as { category: string }[];
    return rows.map((r) => r.category);
  }

  function distinctCategories(): string[] {
    const rows = db
      .prepare(
        `SELECT category FROM (
           SELECT category FROM transactions WHERE category <> ''
           UNION
           SELECT displayName as category FROM categories
         )
         WHERE category <> ''
           AND category NOT IN (SELECT displayName FROM deleted_categories)
         GROUP BY category
         ORDER BY category`,
      )
      .all() as { category: string }[];
    return rows.map((r) => r.category);
  }

  function monthlyTotals(filters?: { tagIds?: string[]; accountIds?: string[] }): MonthlyTotal[] {
    const clauses: string[] = ["COALESCE(cat.classification, 'expense') != 'ignored'"];
    const params: unknown[] = [];

    if (filters?.accountIds?.length) {
      clauses.push(`t.accountId IN (${filters.accountIds.map(() => "?").join(",")})`);
      params.push(...filters.accountIds);
    }
    if (filters?.tagIds?.length) {
      const ph = filters.tagIds.map(() => "?").join(",");
      clauses.push(
        `(EXISTS (SELECT 1 FROM transaction_tags tt WHERE tt.transactionId = t.id AND tt.tagId IN (${ph}))
          OR EXISTS (SELECT 1 FROM account_tags atg WHERE atg.accountId = t.accountId AND atg.tagId IN (${ph})))`,
      );
      params.push(...filters.tagIds, ...filters.tagIds);
    }

    const where = `WHERE ${clauses.join(" AND ")}`;
    const sql = `
      SELECT
        strftime('%Y-%m', COALESCE(NULLIF(t.originalDate, ''), t.date)) AS month,
        ROUND(SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END), 2) AS income,
        ROUND(ABS(SUM(CASE WHEN t.amount < 0 THEN t.amount ELSE 0 END)), 2) AS spend
      FROM transactions t
      LEFT JOIN categories cat ON cat.displayName = t.category
      ${where}
      GROUP BY month
      ORDER BY month DESC
      LIMIT 24
    `;
    return db.prepare(sql).all(...params) as MonthlyTotal[];
  }

  function categoryBreakdown(month: string): CategoryTotal[] {
    const sql = `
      SELECT
        CASE WHEN t.category = '' THEN 'Uncategorized' ELSE t.category END AS category,
        ROUND(ABS(SUM(t.amount)), 2) AS total,
        COUNT(*) AS count
      FROM transactions t
      LEFT JOIN categories cat ON cat.displayName = t.category
      WHERE strftime('%Y-%m', COALESCE(NULLIF(t.originalDate, ''), t.date)) = ?
        AND t.amount < 0
        AND COALESCE(cat.classification, 'expense') != 'ignored'
      GROUP BY t.category
      ORDER BY total DESC
    `;
    return db.prepare(sql).all(month) as CategoryTotal[];
  }

  function tagBreakdown(month: string): TagTotal[] {
    // Tags can overlap: a transaction in two tag buckets contributes to both
    const sql = `
      WITH tx AS (
        SELECT t.id, t.amount, t.accountId FROM transactions t
        LEFT JOIN categories cat ON cat.displayName = t.category
        WHERE strftime('%Y-%m', COALESCE(NULLIF(t.originalDate, ''), t.date)) = ?
          AND t.amount < 0
          AND COALESCE(cat.classification, 'expense') != 'ignored'
      ),
      tx_with_tags AS (
        SELECT tx.id, tx.amount, tt.tagId AS tag
        FROM tx JOIN transaction_tags tt ON tt.transactionId = tx.id
        UNION
        SELECT tx.id, tx.amount, atg.tagId AS tag
        FROM tx JOIN account_tags atg ON atg.accountId = tx.accountId
      )
      SELECT
        COALESCE(tg.tag, 'untagged') AS tag,
        ROUND(ABS(SUM(tx.amount)), 2) AS total,
        COUNT(DISTINCT tx.id) AS count
      FROM tx
      LEFT JOIN tx_with_tags tg ON tg.id = tx.id
      GROUP BY tg.tag
      ORDER BY total DESC
    `;
    return db.prepare(sql).all(month) as TagTotal[];
  }

  return { bulkUpsert, list, query, getById, getByIds, updateTransaction, deleteTransaction, createManual, distinctCategories, categoriesWithTransactions, distinctCategoriesMatching, monthlyTotals, categoryBreakdown, tagBreakdown };
}

export type TransactionRepo = ReturnType<typeof makeTransactionRepo>;
