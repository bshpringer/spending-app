"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getDb } from "./db.ts";
import { DEFAULT_PROFILE_ID } from "./constants.ts";
import { makeAccountRepo } from "./repo/accountRepo.ts";
import { formatAccountLabel } from "./format.ts";
import { makeTransactionRepo } from "./repo/transactionRepo.ts";
import { makeTagRepo } from "./repo/tagRepo.ts";
import {
  makeCollisionRepo,
  type CollisionDecision,
  type CollisionStatus,
} from "./repo/collisionRepo.ts";
import { makeCategoryRepo } from "./repo/categoryRepo.ts";
import { makeRuleRepo } from "./repo/ruleRepo.ts";
import type {
  CsvParseResult,
  ImportSummary,
  Rule,
  RuleCondition,
  RuleAction,
  ImportClassification,
  ClassifiedImportRow,
  AmbiguousCandidate,
  ImportDecisionsInput,
  Transaction,
  TransactionUserOverrides,
  Account,
} from "./types.ts";
import { evaluateRules } from "./evaluate.ts";
import { effectiveTransactions } from "./aggregations.ts";
import type { TransactionUpdateInput, TransactionFilters } from "./repo/transactionRepo.ts";
import type { CategoryTxRow, CategoryTxPage } from "./categoryDateRange.ts";
import { buildLinkedRefundRows } from "./refundNetting.ts";
import { matchesAll, resolveTags } from "./evaluate.ts";
import { makeProfileRepo } from "./repo/profileRepo.ts";
import { makeRecurringDismissalRepo } from "./repo/recurringDismissalRepo.ts";
import { makeRefundMatchRepo } from "./repo/refundMatchRepo.ts";
import { makeDuplicateReviewRepo } from "./repo/duplicateReviewRepo.ts";
import { makeMerchantAliasRepo } from "./repo/merchantAliasRepo.ts";
import type { MerchantAliasSourceKind } from "./types.ts";
import { currentUserId, accessibleProfiles } from "./auth.ts";
import { makePlaidItemRepo } from "./repo/plaidItemRepo.ts";
import { makeReconciliationReviewRepo } from "./repo/reconciliationReviewRepo.ts";
import {
  applyReconciliation,
  type ReconcileEnrichment,
  type ApplyReconcileOptions,
  type ApplyReconcileResult,
} from "./reconcileWrite.ts";
import { detectReconciliations, type ReconcileTier } from "./reconcile.ts";
import { pullHistoricalWindow } from "./plaid/referencePull.ts";
import { aggregationDate } from "./period.ts";

export async function getCategoryTransactionsPage(
  category: string,
  from: string | null,
  to: string | null,
  offset: number,
  limit: number,
  profileIds: string[] | null = null,
  sortBy: "date" | "amountAbsDesc" = "date",
  sortKey: "date" | "name" | "amount" | null = null,
  sortDir: "asc" | "desc" = "desc",
): Promise<CategoryTxPage> {
  const db = getDb();
  const refundMatchRepo = makeRefundMatchRepo(db);
  const allPairs = refundMatchRepo.allConfirmedPairs();
  const refundIds = allPairs.map((p) => p.refundId);

  const conds: string[] = [];
  const params: unknown[] = [];
  if (category === "Uncategorized" || category === "") {
    conds.push("(t.category = '' OR t.category = 'Uncategorized')");
  } else {
    conds.push("t.category = ?");
    params.push(category);
  }
  if (from) { conds.push("COALESCE(NULLIF(t.originalDate, ''), t.date) >= ?"); params.push(from); }
  if (to) { conds.push("COALESCE(NULLIF(t.originalDate, ''), t.date) <= ?"); params.push(to); }
  if (profileIds && profileIds.length > 0) {
    conds.push(`t.profileId IN (${profileIds.map(() => "?").join(",")})`);
    params.push(...profileIds);
  }
  // Suppress confirmed refunds from the top-level page set — they only appear
  // nested under their expense via linkedRefunds. Keeps `total` accurate.
  if (refundIds.length > 0) {
    conds.push(`t.id NOT IN (${refundIds.map(() => "?").join(",")})`);
    params.push(...refundIds);
  }
  const where = conds.join(" AND ");

  const totalRow = db.prepare(`SELECT COUNT(*) as c FROM transactions t WHERE ${where}`).get(...params) as { c: number };
  const dateExpr = "COALESCE(NULLIF(t.originalDate, ''), t.date)";
  // Three order-by modes:
  //   1. sortKey explicit (user clicked a column header) → standard signed sort
  //   2. sortBy === "amountAbsDesc" → biggest |amount| first (drill-down default)
  //   3. otherwise → newest aggregation date first (legacy default)
  function buildOrderBy(): string {
    if (sortKey) {
      const dir = sortDir === "desc" ? "DESC" : "ASC";
      const nameExpr = "LOWER(COALESCE(NULLIF(t.customName, ''), NULLIF(t.canonicalName, ''), t.name))";
      switch (sortKey) {
        case "date": return `${dateExpr} ${dir}, t.id DESC`;
        case "name": return `${nameExpr} ${dir}, ${dateExpr} DESC, t.id DESC`;
        case "amount": return `t.amount ${dir}, ${dateExpr} DESC, t.id DESC`;
      }
    }
    if (sortBy === "amountAbsDesc") {
      return `ABS(t.amount) DESC, ${dateExpr} DESC, t.id DESC`;
    }
    return `${dateExpr} DESC, t.id DESC`;
  }
  const orderBy = buildOrderBy();

  const rows = db.prepare(
    `SELECT t.id, t.date, t.originalDate, t.name, t.customName, t.canonicalName, t.amount, t.category, t.note, t.accountId, t.profileId,
            IFNULL(json_extract(t.userOverrides, '$.excluded'), 0) as excludedFlag,
            IFNULL(json_extract(t.userOverrides, '$.oneTime'), 0) as oneTimeFlag,
            (SELECT json_group_array(tagId) FROM transaction_tags WHERE transactionId = t.id) as tags
     FROM transactions t WHERE ${where}
     ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset) as {
    id: string; date: string; originalDate: string | null; name: string; customName: string | null; canonicalName: string | null; amount: number; category: string; note: string; tags: string; excludedFlag: number; oneTimeFlag: number; accountId: string | null; profileId: string | null;
  }[];

  const mappedRows: CategoryTxRow[] = rows.map((r) => ({
    id: r.id,
    date: r.originalDate || r.date,
    originalDate: r.originalDate ?? undefined,
    name: r.name,
    customName: r.customName ?? undefined,
    canonicalName: r.canonicalName ?? undefined,
    category: r.category,
    amount: r.amount,
    note: r.note,
    tags: JSON.parse(r.tags) as string[],
    excluded: r.excludedFlag === 1,
    oneTime: r.oneTimeFlag === 1,
    accountId: r.accountId,
    profileId: r.profileId ?? undefined,
  }));

  const txRepo = makeTransactionRepo(db);
  const visibleExpenseIds = new Set(mappedRows.map((r) => r.id));
  const linkedRefundsMap = buildLinkedRefundRows(visibleExpenseIds, allPairs, txRepo);
  const linkedRefunds: Record<string, CategoryTxRow[]> = Object.fromEntries(
    Array.from(linkedRefundsMap.entries()).map(([expenseId, rs]) => [
      expenseId,
      rs as unknown as CategoryTxRow[],
    ]),
  );

  return { rows: mappedRows, total: totalRow.c, linkedRefunds };
}

/**
 * Paged date-window query used by the dashboard Pacing drill-down. Filters
 * down to the transactions that actually contribute to the pacing chart's
 * spend curve: rules applied, excluded / ignored-classification / income-class
 * rows dropped, positive non-refund rows dropped. Confirmed refunds are
 * suppressed from the top-level set and surfaced via `linkedRefunds`.
 * Defaults to amount ASC (most-negative = biggest expense first).
 */
export async function getPacingDrillTransactionsPage(
  from: string,
  to: string,
  offset: number,
  limit: number,
  profileIds: string[] | null = null,
  sortKey: "date" | "name" | "amount" = "amount",
  sortDir: "asc" | "desc" = "asc",
): Promise<CategoryTxPage> {
  const db = getDb();
  const txRepo = makeTransactionRepo(db);
  const refundMatchRepo = makeRefundMatchRepo(db);
  const ruleRepo = makeRuleRepo(db);
  const categoryRepo = makeCategoryRepo(db);
  const accountRepo = makeAccountRepo(db);

  const allPairs = refundMatchRepo.allConfirmedPairs();
  const confirmedRefundIds = new Set(allPairs.map((p) => p.refundId));

  const raw = txRepo.query({
    profileIds: profileIds ?? undefined,
    from,
    to,
  });

  const rules = ruleRepo.list().filter((r) => r.enabled);
  const categoryObjects = categoryRepo.list();
  const categoryMap = new Map(categoryObjects.map((c) => [c.displayName, c]));
  const accountTagMap = accountRepo.tagMap();

  // Mirror pacing.ts: apply rules + drop excluded/ignored, then drop income
  // categories + drop positive non-refund rows (one-time stays in — the chart
  // toggles it client-side; including everything here keeps the drill-down
  // honest regardless of the toggle).
  const effective = effectiveTransactions(raw, rules, categoryMap, accountTagMap);
  const filtered = effective.filter((tx) => {
    if (confirmedRefundIds.has(tx.id)) return false; // surfaced as children
    const classification = categoryMap.get(tx.category || "Uncategorized")?.classification;
    if (classification === "income") return false;
    if (tx.amount > 0) return false; // positive non-refund (cash-out / income leak)
    return true;
  });

  // JS-side sort: small payload (one bucket worth of rows).
  const dirMul = sortDir === "desc" ? -1 : 1;
  filtered.sort((a, b) => {
    if (sortKey === "amount") {
      if (a.amount !== b.amount) return (a.amount - b.amount) * dirMul;
    } else if (sortKey === "name") {
      const an = (a.customName || a.canonicalName || a.name).toLowerCase();
      const bn = (b.customName || b.canonicalName || b.name).toLowerCase();
      if (an !== bn) return (an < bn ? -1 : 1) * dirMul;
    } else {
      const ad = a.originalDate || a.date;
      const bd = b.originalDate || b.date;
      if (ad !== bd) return (ad < bd ? -1 : 1) * dirMul;
    }
    return a.id < b.id ? 1 : -1; // stable tiebreaker, newest id first
  });

  const total = filtered.length;
  const pageRows = filtered.slice(offset, offset + limit);

  const mappedRows: CategoryTxRow[] = pageRows.map((t) => ({
    id: t.id,
    date: t.originalDate || t.date,
    originalDate: t.originalDate ?? undefined,
    name: t.name,
    customName: t.customName ?? undefined,
    canonicalName: t.canonicalName ?? undefined,
    category: t.category,
    amount: t.amount,
    note: t.note,
    tags: t.tags,
    excluded: t.userOverrides?.excluded === true,
    oneTime: t.userOverrides?.oneTime === true,
    accountId: t.accountId,
    profileId: t.profileId ?? undefined,
  }));

  const visibleExpenseIds = new Set(mappedRows.map((r) => r.id));
  const linkedRefundsMap = buildLinkedRefundRows(visibleExpenseIds, allPairs, txRepo);
  const linkedRefunds: Record<string, CategoryTxRow[]> = Object.fromEntries(
    Array.from(linkedRefundsMap.entries()).map(([expenseId, rs]) => [
      expenseId,
      rs as unknown as CategoryTxRow[],
    ]),
  );

  return { rows: mappedRows, total, linkedRefunds };
}

/**
 * Paged transactions query for the /transactions page client wrapper. Mirrors
 * the server-component logic in src/app/transactions/page.tsx (filter set,
 * confirmed-refund suppression, row mapping) so swapping pages in-place via
 * this action produces the same rows as a hard navigation would.
 */
export async function getTransactionsPage(
  filters: TransactionFilters,
  offset: number,
  limit: number,
): Promise<CategoryTxPage> {
  const db = getDb();
  const txRepo = makeTransactionRepo(db);
  const allMatches = txRepo.query(filters);

  const refundMatchRepo = makeRefundMatchRepo(db);
  const allPairs = refundMatchRepo.allConfirmedPairs();
  const suppressedRefundIds = new Set(allPairs.map((p) => p.refundId));
  const filtered = allMatches.filter((t) => !suppressedRefundIds.has(t.id));

  const total = filtered.length;
  const pageRows = filtered.slice(offset, offset + limit);

  const categoryMap = new Map(makeCategoryRepo(db).list().map((c) => [c.displayName, c]));

  const mappedRows: CategoryTxRow[] = pageRows.map((t) => ({
    id: t.id,
    date: t.originalDate || t.date,
    originalDate: t.originalDate ?? undefined,
    name: t.name,
    customName: t.customName ?? undefined,
    canonicalName: t.canonicalName ?? undefined,
    category: t.category,
    amount: t.amount,
    note: t.note,
    tags: t.tags,
    excluded: t.userOverrides.excluded === true || categoryMap.get(t.category)?.classification === "ignored",
    oneTime: t.userOverrides.oneTime === true,
    accountId: t.accountId,
    profileId: t.profileId ?? undefined,
  }));

  const visibleExpenseIds = new Set(mappedRows.map((r) => r.id));
  const linkedRefundsMap = buildLinkedRefundRows(visibleExpenseIds, allPairs, txRepo);
  const linkedRefunds: Record<string, CategoryTxRow[]> = Object.fromEntries(
    Array.from(linkedRefundsMap.entries()).map(([expenseId, rs]) => [
      expenseId,
      rs as unknown as CategoryTxRow[],
    ]),
  );

  return { rows: mappedRows, total, linkedRefunds };
}

export async function importParsedCsv(
  parsed: CsvParseResult,
  decisions: ImportDecisionsInput = {},
): Promise<ImportSummary> {
  const db = getDb();
  const accounts = makeAccountRepo(db);
  const transactions = makeTransactionRepo(db);
  const tags = makeTagRepo(db);
  const categories = makeCategoryRepo(db);

  let newAccounts = 0;
  const accountIdByNaturalKey = new Map<string, string>();
  for (const parsedAccount of parsed.accounts) {
    const existed = accounts.findByNaturalKey(parsedAccount.naturalKey) !== null;
    const account = accounts.getOrCreate(parsedAccount);
    if (!existed) newAccounts++;
    accountIdByNaturalKey.set(parsedAccount.naturalKey, account.id);
  }

  let newTags = 0;
  const tagsBefore = new Set(tags.list().map((t) => t.id));
  for (const displayName of parsed.tagDisplayNames) {
    tags.ensureExists(displayName);
  }
  for (const tag of tags.list()) {
    if (!tagsBefore.has(tag.id)) newTags++;
  }

  // Tombstoned categories: the user deleted these. Rewrite incoming transactions
  // in those categories to Uncategorized so re-imports respect prior deletions.
  const tombstoned = new Set(
    (db.prepare(`SELECT displayName FROM deleted_categories`).all() as { displayName: string }[])
      .map((r) => r.displayName),
  );
  const cleanedTransactions = tombstoned.size === 0
    ? parsed.transactions
    : parsed.transactions.map((t) => (tombstoned.has(t.category) ? { ...t, category: "" } : t));

  // Build skip set: rows the user dropped from this import (New) +
  // ambiguous rows the user did NOT explicitly Keep/Replace (default Skip).
  const skipKeys = new Set<string>(decisions.skipNew ?? []);
  const keepAmbiguous = new Set<string>(decisions.keepAmbiguous ?? []);
  // Replace = keep + delete existing rows. Merge into keepAmbiguous so
  // they aren't skipped; track IDs to delete before bulkUpsert.
  const replaceMap = decisions.replaceAmbiguous ?? {};
  for (const key of Object.keys(replaceMap)) {
    keepAmbiguous.add(key);
  }
  if (keepAmbiguous.size > 0 || (decisions.skipNew?.length ?? 0) > 0) {
    const classification = await classifyParsedAgainstDb(parsed);
    for (const row of classification.rows) {
      if (row.bucket === "ambiguous" && !keepAmbiguous.has(row.parsed.dedupeKey)) {
        skipKeys.add(row.parsed.dedupeKey);
      }
    }
  }
  // Delete existing DB rows the user chose to replace with incoming rows.
  for (const ids of Object.values(replaceMap)) {
    for (const id of ids) {
      transactions.deleteTransaction(id);
    }
  }

  // Build overrides map (mirror category to row.category if changed so the row
  // commits with the right category column too).
  const overridesByDedupeKey = new Map<string, TransactionUserOverrides>();
  const profileIdByDedupeKey = new Map<string, string>();
  for (const [key, dec] of Object.entries(decisions.overrides ?? {})) {
    const ov: TransactionUserOverrides = {};
    if (dec.category !== undefined) ov.category = dec.category;
    if (dec.customName !== undefined) ov.customName = dec.customName;
    if (dec.note !== undefined) ov.note = dec.note;
    if (dec.tags !== undefined) ov.tags = dec.tags;
    if (dec.excluded) ov.excluded = true;
    if (dec.oneTime) ov.oneTime = true;
    overridesByDedupeKey.set(key, ov);
    if (dec.profileId) profileIdByDedupeKey.set(key, dec.profileId);
  }

  // Seed any new categories seen in this import (INSERT OR IGNORE — never overwrites classification)
  const distinctCategoriesSet = new Set<string>();
  for (const t of cleanedTransactions) {
    if (t.category) distinctCategoriesSet.add(t.category);
  }
  for (const ov of overridesByDedupeKey.values()) {
    if (ov.category) distinctCategoriesSet.add(ov.category);
  }
  for (const cat of distinctCategoriesSet) {
    categories.ensureExists(cat);
  }

  // profileId stamp for each incoming row, inherited from its account.
  const profileIdByAccountId = new Map<string, string>();
  for (const account of accounts.list()) {
    profileIdByAccountId.set(account.id, account.profileId);
  }

  const importBatchId = randomUUID();
  const upsert = transactions.bulkUpsert(
    cleanedTransactions,
    accountIdByNaturalKey,
    profileIdByAccountId,
    importBatchId,
    { skipDedupeKeys: skipKeys, overridesByDedupeKey, profileIdByDedupeKey },
  );

  // Revalidate so the new transactions surface immediately on the destination page.
  revalidatePath("/transactions");
  revalidatePath("/trends");
  revalidatePath("/categories");

  return {
    newTransactions: upsert.newCount,
    matchedExisting: upsert.matchedCount,
    newAccounts,
    newTags,
    warnings: parsed.warnings,
    importBatchId: upsert.newCount > 0 ? importBatchId : null,
  };
}

/**
 * Classifies every parsed CSV row into New / Duplicate / Ambiguous against the
 * current DB state. Pure read — does not write. Used by the /import preview
 * so the user can see what will actually land, edit New rows inline, and
 * decide per-row on Ambiguous near-duplicates before committing.
 *
 * - Duplicate: exact dedupeKey hit in DB. Will be skipped on save.
 * - Ambiguous: same (originalDate, accountId, csvAmount) as an existing DB row
 *   but different name/description. Default action is Skip; user can Keep per row.
 * - New: everything else. Editable in the preview; userOverrides on save.
 */
export async function classifyImportRows(parsed: CsvParseResult): Promise<ImportClassification> {
  return classifyParsedAgainstDb(parsed);
}

// Soft-match window (days) used to flag near-duplicates whose originalDate slipped
// during Rocket Money's pending → posted churn.
const AMBIGUOUS_DATE_WINDOW_DAYS = 7;

function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function daysApart(a: string, b: string): number {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return Number.POSITIVE_INFINITY;
  return Math.abs(Math.round((tb - ta) / 86400000));
}

function shiftIso(d: string, days: number): string {
  const t = Date.parse(d);
  if (!Number.isFinite(t)) return d;
  return new Date(t + days * 86400000).toISOString().slice(0, 10);
}

async function classifyParsedAgainstDb(parsed: CsvParseResult): Promise<ImportClassification> {
  const db = getDb();
  const accounts = makeAccountRepo(db);
  const rules = makeRuleRepo(db);
  const categoriesRepo = makeCategoryRepo(db);
  const tagsRepo = makeTagRepo(db);

  // Account lookup: existing naturalKey → Account. Missing keys = brand-new accounts in this import.
  const accountByNaturalKey = new Map<string, Account>();
  const accountIdByNaturalKey = new Map<string, string>();
  const newAccountNaturalKeys: string[] = [];
  for (const a of parsed.accounts) {
    const existing = accounts.findByNaturalKey(a.naturalKey);
    if (existing) {
      accountByNaturalKey.set(a.naturalKey, existing);
      accountIdByNaturalKey.set(a.naturalKey, existing.id);
    } else {
      newAccountNaturalKeys.push(a.naturalKey);
    }
  }
  // Pretty label cache for ambiguous candidates (existing DB rows may belong to any account).
  const accountLabelById = new Map<string, string>();
  for (const acct of accounts.list()) {
    accountLabelById.set(acct.id, formatAccountLabel(acct));
  }
  // Lookup by naturalKey for the incoming row's account display.
  function labelForNaturalKey(nk: string): string | null {
    const acct = accountByNaturalKey.get(nk);
    if (!acct) return null;
    return accountLabelById.get(acct.id) ?? acct.accountName;
  }

  // Widen the DB lookup window by the soft-match tolerance so cross-day
  // matches like (5/18 in DB) vs (5/20 incoming) are reachable.
  let from: string | null = null;
  let to: string | null = null;
  for (const t of parsed.transactions) {
    const d = t.originalDate || t.date;
    if (!d) continue;
    if (from === null || d < from) from = d;
    if (to === null || d > to) to = d;
  }
  const fromWidened = from ? shiftIso(from, -AMBIGUOUS_DATE_WINDOW_DAYS) : null;
  const toWidened = to ? shiftIso(to, AMBIGUOUS_DATE_WINDOW_DAYS) : null;

  type DbRow = {
    id: string;
    dedupeKey: string;
    accountId: string | null;
    date: string;
    originalDate: string;
    name: string;
    customName: string | null;
    amount: number;
    csvAmount: number;
    description: string;
    category: string;
    note: string;
  };
  const existing: DbRow[] = fromWidened && toWidened
    ? (db
        .prepare(
          `SELECT id, dedupeKey, accountId, date, originalDate, name, customName, amount, csvAmount, description, category, note
           FROM transactions WHERE originalDate BETWEEN ? AND ?`,
        )
        .all(fromWidened, toWidened) as DbRow[])
    : [];

  const byDedupeKey = new Map<string, DbRow>();
  // Index by (accountId, csvAmount): all rows with the same account + amount go
  // here, then we filter per-incoming-row by date window or description match.
  const byAccountAmount = new Map<string, DbRow[]>();
  for (const row of existing) {
    byDedupeKey.set(row.dedupeKey, row);
    if (row.accountId) {
      const k = `${row.accountId}|${row.csvAmount.toFixed(2)}`;
      const list = byAccountAmount.get(k);
      if (list) list.push(row);
      else byAccountAmount.set(k, [row]);
    }
  }

  const parsedDedupeKeys = new Set(parsed.transactions.map((t) => t.dedupeKey));
  const enabledRules: Rule[] = rules.list().filter((r) => r.enabled);

  const rows: ClassifiedImportRow[] = [];
  let newCount = 0;
  let dupCount = 0;
  let ambCount = 0;
  const overlapDates = new Set<string>();

  for (const parsedTx of parsed.transactions) {
    const accountId = accountIdByNaturalKey.get(parsedTx.accountNaturalKey);
    const accountLabel = labelForNaturalKey(parsedTx.accountNaturalKey);
    const defaultProfileId =
      accountByNaturalKey.get(parsedTx.accountNaturalKey)?.profileId ?? null;

    const dup = byDedupeKey.get(parsedTx.dedupeKey);
    if (dup) {
      rows.push({
        parsed: parsedTx,
        bucket: "duplicate",
        matchedExistingId: dup.id,
        accountLabel,
        defaultProfileId,
      });
      dupCount++;
      if (parsedTx.originalDate) overlapDates.add(parsedTx.originalDate);
      continue;
    }

    // Ambiguous candidates: same (accountId, csvAmount) where the existing row is either
    // (a) within ±N days of the incoming originalDate, OR (b) has a matching description
    // / name regardless of date — catches the "Rocket Money re-listed this charge with
    // a different originalDate" case (e.g. 5/18 Lyft → reappears as 5/20 Lyft).
    let candidates: AmbiguousCandidate[] = [];
    const reasons = new Set<string>();
    if (accountId) {
      const k = `${accountId}|${parsedTx.csvAmount.toFixed(2)}`;
      const pool = byAccountAmount.get(k) ?? [];
      const incomingName = normalizeForMatch(parsedTx.name);
      const incomingDesc = normalizeForMatch(parsedTx.description);
      const seen = new Set<string>();
      for (const m of pool) {
        if (parsedDedupeKeys.has(m.dedupeKey)) continue; // already a Duplicate bucket sibling
        if (seen.has(m.id)) continue;

        const dDays = daysApart(parsedTx.originalDate, m.originalDate);
        
        // 1. MUST be within the 7-day window to even be considered ambiguous.
        // This prevents monthly recurring charges (30 days apart) from being flagged.
        if (dDays > AMBIGUOUS_DATE_WINDOW_DAYS) continue;

        const nameMatch = normalizeForMatch(m.name) === incomingName;
        const descMatch = incomingDesc.length > 0 && normalizeForMatch(m.description) === incomingDesc;

        // 2. Within the 7-day window, it's ambiguous IF:
        //    - It happened on the exact same day (highly suspicious even if name changed)
        //    - OR the name matches
        //    - OR the statement description matches
        if (dDays > 0 && !nameMatch && !descMatch) continue;

        if (nameMatch) reasons.add("matching name");
        if (descMatch) reasons.add("matching statement description");
        if (dDays === 0 && !nameMatch && !descMatch) reasons.add("same day, different name");
        else if (dDays > 0) reasons.add(`±${dDays}d date drift`);
        
        seen.add(m.id);
        candidates.push({
          id: m.id,
          date: m.date,
          originalDate: m.originalDate,
          name: m.name,
          customName: m.customName,
          amount: m.amount,
          description: m.description,
          category: m.category,
          note: m.note,
          dedupeKey: m.dedupeKey,
        });
      }
    }

    if (candidates.length > 0) {
      rows.push({
        parsed: parsedTx,
        bucket: "ambiguous",
        candidates,
        ambiguousReasons: Array.from(reasons),
        accountLabel,
        defaultProfileId,
      });
      ambCount++;
      continue;
    }

    let ruleEffects;
    if (enabledRules.length > 0) {
      const stub: Transaction = {
        id: "preview",
        dedupeKey: parsedTx.dedupeKey,
        accountId: accountId ?? null,
        profileId: defaultProfileId ?? DEFAULT_PROFILE_ID,
        date: parsedTx.date,
        originalDate: parsedTx.originalDate,
        name: parsedTx.name,
        customName: undefined,
        amount: parsedTx.amount,
        csvAmount: parsedTx.csvAmount,
        description: parsedTx.description,
        category: parsedTx.category,
        note: parsedTx.note,
        ignoredFrom: parsedTx.ignoredFrom,
        taxDeductible: parsedTx.taxDeductible,
        tags: parsedTx.tags,
        userOverrides: {},
        importedFromCsvAt: "",
        importBatchId: null,
        source: "csv",
        plaidRaw: null,
        createdAt: "",
        updatedAt: "",
      };
      ruleEffects = evaluateRules(enabledRules, stub);
    }

    rows.push({
      parsed: parsedTx,
      bucket: "new",
      ruleEffects,
      accountLabel,
      defaultProfileId,
    });
    newCount++;
  }

  const existingCategories = categoriesRepo.list().map((c) => c.displayName).sort();
  const existingTags = tagsRepo.list().map((t) => t.displayName).sort();
  const profiles = accessibleProfiles();

  return {
    rows,
    counts: { parsed: parsed.transactions.length, new: newCount, duplicate: dupCount, ambiguous: ambCount },
    dateSpan: from && to ? { from, to } : null,
    overlapDays: overlapDates.size,
    newAccountNaturalKeys,
    existingCategories,
    existingTags,
    accessibleProfiles: profiles,
    collisions: parsed.collisions,
    warnings: parsed.warnings,
  };
}

export async function deleteTransaction(id: string): Promise<void> {
  makeTransactionRepo(getDb()).deleteTransaction(id);
  revalidatePath("/transactions");
  revalidatePath("/trends");
  revalidatePath("/categories");
}

export async function bulkDeleteTransactions(ids: string[]): Promise<void> {
  const repo = makeTransactionRepo(getDb());
  for (const id of ids) repo.deleteTransaction(id);
  revalidatePath("/transactions");
  revalidatePath("/trends");
  revalidatePath("/categories");
}

export interface ManualTransactionFormInput {
  date: string;
  name: string;
  amount: number;
  accountId?: string | null;
  profileId?: string;
  category?: string;
  note?: string;
  tags?: string[];
  customName?: string | null;
  excluded?: boolean;
  oneTime?: boolean;
}

export async function createManualTransaction(input: ManualTransactionFormInput): Promise<string> {
  // If no profileId provided, inherit from selected account; manual entries
  // without an account fall back to the default profile.
  let profileId = input.profileId;
  if (!profileId) {
    if (input.accountId) {
      const account = makeAccountRepo(getDb()).findById(input.accountId);
      profileId = account?.profileId ?? DEFAULT_PROFILE_ID;
    } else {
      profileId = DEFAULT_PROFILE_ID;
    }
  }
  const id = makeTransactionRepo(getDb()).createManual({ ...input, profileId });
  revalidatePath("/transactions");
  revalidatePath("/trends");
  revalidatePath("/categories");
  return id;
}

export async function listCollisionDecisions(): Promise<CollisionDecision[]> {
  return makeCollisionRepo(getDb()).list();
}

export async function setCollisionDecision(
  baseDedupeKey: string,
  status: CollisionStatus,
  note?: string,
): Promise<void> {
  makeCollisionRepo(getDb()).set(baseDedupeKey, status, note ?? null);
}

export async function clearCollisionDecision(baseDedupeKey: string): Promise<void> {
  makeCollisionRepo(getDb()).clear(baseDedupeKey);
}

export async function renameAccount(accountId: string, customName: string | null): Promise<void> {
  const trimmed = customName?.trim() ?? null;
  makeAccountRepo(getDb()).setCustomName(accountId, trimmed && trimmed.length > 0 ? trimmed : null);
  revalidatePath("/settings/accounts");
}

export async function setAccountArchived(accountId: string, archived: boolean): Promise<void> {
  makeAccountRepo(getDb()).setArchived(accountId, archived);
  revalidatePath("/settings/accounts");
  revalidatePath("/transactions");
}

export async function addAccountTag(accountId: string, tagDisplayName: string): Promise<void> {
  const db = getDb();
  const trimmed = tagDisplayName.trim();
  if (!trimmed) return;
  const tag = makeTagRepo(db).ensureExists(trimmed);
  makeAccountRepo(db).addTag(accountId, tag.id);
  revalidatePath("/settings/accounts");
  revalidatePath("/transactions");
}

export async function removeAccountTag(accountId: string, tagId: string): Promise<void> {
  makeAccountRepo(getDb()).removeTag(accountId, tagId);
  revalidatePath("/settings/accounts");
  revalidatePath("/transactions");
}

export async function setAccountProfile(accountId: string, profileId: string): Promise<void> {
  makeAccountRepo(getDb()).setProfile(accountId, profileId);
  revalidatePath("/settings/accounts");
  revalidatePath("/transactions");
  revalidatePath("/trends");
  revalidatePath("/categories");
}

export async function setAccountGroup(
  accountId: string,
  group: import("./accountGroups.ts").AccountGroup,
): Promise<void> {
  const { isAccountGroup } = await import("./accountGroups.ts");
  if (!isAccountGroup(group)) throw new Error(`Invalid account group: ${group}`);
  makeAccountRepo(getDb()).setGroup(accountId, group);
  revalidatePath("/settings/accounts");
  revalidatePath("/dashboard");
}

export async function createProfile(input: {
  id: string;
  displayName: string;
  color?: string;
  isShared?: boolean;
}): Promise<void> {
  const slug = input.id.trim().toLowerCase().replace(/[^a-z0-9-_]/g, "-");
  if (!slug || !input.displayName.trim()) return;
  const db = getDb();
  const repo = makeProfileRepo(db);
  repo.create({
    id: slug,
    displayName: input.displayName.trim(),
    color: input.color,
    ownerUserId: currentUserId(),
    isShared: input.isShared,
  });
  repo.grantAccess(currentUserId(), slug);
  revalidatePath("/settings/profiles");
  revalidatePath("/settings/accounts");
  revalidatePath("/", "layout");
}

export async function updateProfile(
  id: string,
  patch: { displayName?: string; color?: string | null },
): Promise<void> {
  makeProfileRepo(getDb()).update(id, patch);
  revalidatePath("/settings/profiles");
  revalidatePath("/", "layout");
}

export async function archiveProfile(id: string): Promise<void> {
  makeProfileRepo(getDb()).archive(id);
  revalidatePath("/settings/profiles");
  revalidatePath("/", "layout");
}

export async function grantProfileAccess(userId: string, profileId: string): Promise<void> {
  makeProfileRepo(getDb()).grantAccess(userId, profileId);
  revalidatePath("/settings/profiles");
  revalidatePath("/", "layout");
}

export async function revokeProfileAccess(userId: string, profileId: string): Promise<void> {
  makeProfileRepo(getDb()).revokeAccess(userId, profileId);
  revalidatePath("/settings/profiles");
  revalidatePath("/", "layout");
}

export async function setCategoryClassification(
  displayName: string,
  classification: string,
): Promise<void> {
  makeCategoryRepo(getDb()).setClassification(displayName, classification);
  revalidatePath("/categories");
  revalidatePath("/trends");
}

export async function setCategoryColor(category: string, color: string | null) {
  getDb().transaction(() => {
    makeCategoryRepo(getDb()).setColor(category, color);
  })();
  revalidatePath("/categories");
  revalidatePath("/trends");
}

export async function setCategoryIcon(category: string, icon: string | null) {
  getDb().transaction(() => {
    makeCategoryRepo(getDb()).setIcon(category, icon);
  })();
  revalidatePath("/categories");
  revalidatePath("/trends");
}

export async function createCategory(input: { displayName: string; classification: string; icon: string | null; color: string | null }) {
  const trimmed = input.displayName.trim();
  if (!trimmed) return;
  getDb().transaction(() => {
    makeCategoryRepo(getDb()).create({ ...input, displayName: trimmed });
  })();
  revalidatePath("/categories");
}

export async function deleteCategory(displayName: string) {
  const db = getDb();
  const tx = db.transaction(() => {
    makeCategoryRepo(db).delete(displayName);
    db.prepare(
      `INSERT OR REPLACE INTO deleted_categories (displayName, deletedAt) VALUES (?, datetime('now'))`,
    ).run(displayName);
    // Cascade: blank category on matching transactions so they fall to Uncategorized.
    // Mirror the change into userOverrides JSON for transactions where the user
    // had explicitly set this category (write-through pattern, matches updateTransaction).
    db.prepare(`UPDATE transactions SET category = '' WHERE category = ?`).run(displayName);
    db.prepare(
      `UPDATE transactions
       SET userOverrides = json_set(userOverrides, '$.category', '')
       WHERE json_extract(userOverrides, '$.category') = ?`,
    ).run(displayName);
  });
  tx();
  revalidatePath("/categories");
  revalidatePath("/trends");
  revalidatePath("/transactions");
}

// Mirror excluded/oneTime/category from expense → refund when a pair is
// confirmed. One-way write at confirm time. Rationale:
//   - excluded/oneTime: keeps trend charts honest (a refund alone would
//     otherwise surface as fake income in a oneTime-excluded month).
//   - category: refunds belong in the same bucket as the original charge so
//     classification-aware aggregations (Trends, transactions stats row,
//     category breakdown) net them out cleanly. Without this, a Plaid-
//     auto-categorized refund could end up under a different (or income-
//     classified) category and inflate income or misroute the spend.
// Only forward propagation; unlinking does NOT roll the mirror back.
function mirrorExpenseFlagsToRefund(expenseId: string, refundId: string): void {
  const repo = makeTransactionRepo(getDb());
  const expense = repo.getById(expenseId);
  const refund = repo.getById(refundId);
  if (!expense || !refund) return;
  const patch: TransactionUpdateInput = {};
  if (expense.userOverrides?.excluded && !refund.userOverrides?.excluded) {
    patch.excluded = true;
  }
  if (expense.userOverrides?.oneTime && !refund.userOverrides?.oneTime) {
    patch.oneTime = true;
  }
  if (expense.category && refund.category !== expense.category) {
    patch.category = expense.category;
  }
  if (Object.keys(patch).length > 0) {
    repo.updateTransaction(refundId, patch);
  }
}

function revalidateRefundPaths(): void {
  revalidatePath("/refunds");
  revalidatePath("/transactions");
  revalidatePath("/trends");
  revalidatePath("/categories");
}

export async function confirmRefundMatch(expenseId: string, refundId: string): Promise<void> {
  makeRefundMatchRepo(getDb()).confirm(expenseId, refundId);
  mirrorExpenseFlagsToRefund(expenseId, refundId);
  revalidateRefundPaths();
}

export async function rejectRefundMatch(expenseId: string, refundId: string): Promise<void> {
  makeRefundMatchRepo(getDb()).reject(expenseId, refundId);
  revalidatePath("/refunds");
}

export async function unlinkRefundMatch(expenseId: string, refundId: string): Promise<void> {
  makeRefundMatchRepo(getDb()).unlink(expenseId, refundId);
  revalidateRefundPaths();
}

function revalidateDuplicatePaths(): void {
  revalidatePath("/duplicates");
  revalidatePath("/transactions");
  revalidatePath("/trends");
}

export async function markDuplicateKept(txAId: string, txBId: string): Promise<void> {
  makeDuplicateReviewRepo(getDb()).markKept(txAId, txBId);
  revalidateDuplicatePaths();
}

export async function restoreDuplicateReview(txAId: string, txBId: string): Promise<void> {
  makeDuplicateReviewRepo(getDb()).unmark(txAId, txBId);
  revalidateDuplicatePaths();
}

// ── /reconcile: cross-source (Rocket CSV ↔ fresh Plaid pull) enrichment ──────
//
// The Plaid side is pulled fresh per request and never committed — committing
// it first would double-count the overlap window the page exists to collapse.
// So the matched Plaid row's enrichment payload (plaidTransactionId / plaidRaw /
// plaidRawFull / category / canonicalName) rides in the DTO out to the client and
// back in on `confirmReconciliation`. The DB only ever stores the decision
// (`reconciliation_reviews`) and the enriched survivor CSV row.

/** The serialized enrichment a matched Plaid row carries back to `confirm`. */
export interface ReconcilePairDTO {
  csv: Transaction;
  plaid: Transaction;
  tier: ReconcileTier;
  daysApart: number;
  reason: string;
  enrich: ReconcileEnrichment;
}

export interface ReconcilePullResult {
  ok: boolean;
  error?: string;
  /** Proposed Rocket↔Plaid pairs awaiting a decision (already reviewed-suppressed). */
  matched: ReconcilePairDTO[];
  /** Plaid rows in-window with no confident Rocket twin (coverage audit). */
  unmatchedPlaid: Transaction[];
  /** Committed CSV rows in-window with no Plaid twin (coverage audit). */
  unmatchedCsv: Transaction[];
  pulledCount: number;
}

/**
 * Map a freshly-pulled Plaid row to a transient `Transaction` whose `id` is its
 * `plaidTransactionId` (the matcher + `reconcilePairKey` key on `id`). This row
 * is never persisted — it exists only for the duration of one match/review pass.
 */
function makeTransientPlaidTransaction(
  r: Awaited<ReturnType<typeof pullHistoricalWindow>>[number],
  accountId: string,
  profileId: string,
): Transaction {
  const now = new Date().toISOString();
  return {
    id: r.plaidTransactionId,
    dedupeKey: `plaid:${r.plaidTransactionId}`,
    accountId,
    profileId,
    date: r.date,
    originalDate: r.originalDate,
    name: r.name,
    canonicalName: r.merchantName ?? undefined,
    amount: r.amount,
    csvAmount: r.csvAmount,
    description: r.description,
    category: r.category,
    note: "",
    ignoredFrom: "",
    taxDeductible: false,
    tags: [],
    userOverrides: {},
    importedFromCsvAt: "",
    importBatchId: null,
    source: "plaid",
    plaidRaw: r.plaidRaw,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Pull a Plaid window for one Item via /transactions/get (cursor untouched),
 * match it against the committed Rocket/CSV rows on the same accounts in the
 * same window, and return the proposed pairs + coverage leftovers. Read-only:
 * writes nothing. The user confirms/rejects individual pairs afterward.
 */
export async function reconcilePull(input: {
  itemId: string;
  from: string;
  to: string;
}): Promise<ReconcilePullResult> {
  const empty: ReconcilePullResult = {
    ok: false,
    matched: [],
    unmatchedPlaid: [],
    unmatchedCsv: [],
    pulledCount: 0,
  };
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  if (!input.itemId) return { ...empty, error: "Missing itemId" };
  if (!ISO.test(input.from) || !ISO.test(input.to)) {
    return { ...empty, error: "Both From and To dates are required (YYYY-MM-DD)." };
  }
  if (input.from > input.to) {
    return { ...empty, error: "From date must be on or before To date." };
  }

  const db = getDb();
  const itemRepo = makePlaidItemRepo(db);
  const accountRepo = makeAccountRepo(db);
  const txRepo = makeTransactionRepo(db);
  const reviewRepo = makeReconciliationReviewRepo(db);

  const accessToken = itemRepo.getAccessToken(input.itemId);
  if (!accessToken) return { ...empty, error: "Item not found." };

  const links = itemRepo.accountLinksByItem(input.itemId);
  if (links.length === 0) {
    return { ...empty, error: "This bank hasn't been reconciled to local accounts yet." };
  }
  const accountIdByPlaid = new Map<string, string>();
  const profileByAccount = new Map<string, string>();
  for (const link of links) {
    const acct = accountRepo.findById(link.accountId);
    if (!acct) continue;
    accountIdByPlaid.set(link.plaidAccountId, acct.id);
    profileByAccount.set(acct.id, acct.profileId);
  }
  const itemAccountIds = new Set(profileByAccount.keys());

  let pulled: Awaited<ReturnType<typeof pullHistoricalWindow>>;
  try {
    pulled = await pullHistoricalWindow({
      accessToken,
      startDate: input.from,
      endDate: input.to,
    });
  } catch (err) {
    return { ...empty, error: errMsg(err) };
  }

  // Transient Plaid side, scoped to this Item's linked sub-accounts.
  const plaidTxns: Transaction[] = [];
  for (const r of pulled) {
    const accountId = accountIdByPlaid.get(r.plaidAccountId);
    if (!accountId) continue;
    plaidTxns.push(
      makeTransientPlaidTransaction(r, accountId, profileByAccount.get(accountId) ?? ""),
    );
  }
  // plaidRawFull isn't on Transaction — keep it beside, keyed by transaction id.
  const rawFullById = new Map<string, string>(
    pulled.map((r) => [r.plaidTransactionId, r.plaidRawFull]),
  );

  // CSV/Rocket enrich targets: committed non-Plaid rows on this Item's accounts,
  // whose canonical (swipe) date falls in the pulled window.
  const csvTxns = txRepo
    .query({})
    .filter(
      (t) =>
        t.source !== "plaid" &&
        t.accountId !== null &&
        itemAccountIds.has(t.accountId) &&
        aggregationDate(t) >= input.from &&
        aggregationDate(t) <= input.to,
    );

  const reviewed = reviewRepo.reviewedPairKeys();
  const matches = detectReconciliations(csvTxns, plaidTxns, reviewed);

  const matchedCsvIds = new Set(matches.map((m) => m.csv.id));
  const matchedPlaidIds = new Set(matches.map((m) => m.plaid.id));

  const matched: ReconcilePairDTO[] = matches.map((m) => ({
    csv: m.csv,
    plaid: m.plaid,
    tier: m.tier,
    daysApart: m.daysApart,
    reason: m.reason,
    enrich: {
      plaidTransactionId: m.plaid.id,
      plaidRaw: m.plaid.plaidRaw ? JSON.stringify(m.plaid.plaidRaw) : null,
      plaidRawFull: rawFullById.get(m.plaid.id) ?? null,
      category: m.plaid.category,
      canonicalName: m.plaid.canonicalName ?? null,
    },
  }));

  return {
    ok: true,
    matched,
    unmatchedPlaid: plaidTxns.filter((p) => !matchedPlaidIds.has(p.id)),
    unmatchedCsv: csvTxns.filter((c) => !matchedCsvIds.has(c.id)),
    pulledCount: pulled.length,
  };
}

function revalidateReconcilePaths(): void {
  revalidatePath("/reconcile");
  revalidatePath("/transactions");
  revalidatePath("/trends");
}

/**
 * Apply a confirmed pair: enrich the survivor CSV row in place + persist the
 * decision, atomically. The enrichment payload is the transient one the pull
 * handed the client (the Plaid row is never in the DB).
 */
export async function confirmReconciliation(
  csvTransactionId: string,
  enrich: ReconcileEnrichment,
  opts: ApplyReconcileOptions = {},
): Promise<{ ok: boolean; error?: string; result?: ApplyReconcileResult }> {
  const db = getDb();
  const reviewRepo = makeReconciliationReviewRepo(db);
  try {
    const run = db.transaction(() => {
      const result = applyReconciliation(db, csvTransactionId, enrich, opts);
      reviewRepo.markReconciled(csvTransactionId, enrich.plaidTransactionId);
      return result;
    });
    const result = run();
    revalidateReconcilePaths();
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
}

export async function rejectReconciliation(
  csvTransactionId: string,
  plaidTransactionId: string,
): Promise<void> {
  makeReconciliationReviewRepo(getDb()).markRejected(csvTransactionId, plaidTransactionId);
  revalidatePath("/reconcile");
}

export interface ReconcileBatchItem {
  csvTransactionId: string;
  enrich: ReconcileEnrichment;
  opts?: ApplyReconcileOptions;
}
export interface ReconcileBatchResult {
  ok: boolean;
  /** Pairs that committed — keyed for the client to drop from its list. */
  succeeded: { csvTransactionId: string; plaidTransactionId: string }[];
  failures: { csvTransactionId: string; plaidTransactionId: string; error: string }[];
}

/**
 * Bulk "Confirm & enrich". Each pair gets its OWN transaction so one bad pair
 * (e.g. a survivor that vanished) can't roll back the rest — friendlier for a
 * one-time migration where the user selects dozens at once.
 */
export async function confirmReconciliationBatch(
  items: ReconcileBatchItem[],
): Promise<ReconcileBatchResult> {
  const db = getDb();
  const reviewRepo = makeReconciliationReviewRepo(db);
  const succeeded: ReconcileBatchResult["succeeded"] = [];
  const failures: ReconcileBatchResult["failures"] = [];
  for (const it of items) {
    const plaidTransactionId = it.enrich.plaidTransactionId;
    try {
      db.transaction(() => {
        applyReconciliation(db, it.csvTransactionId, it.enrich, it.opts ?? {});
        reviewRepo.markReconciled(it.csvTransactionId, plaidTransactionId);
      })();
      succeeded.push({ csvTransactionId: it.csvTransactionId, plaidTransactionId });
    } catch (err) {
      failures.push({ csvTransactionId: it.csvTransactionId, plaidTransactionId, error: errMsg(err) });
    }
  }
  if (succeeded.length > 0) revalidateReconcilePaths();
  return { ok: failures.length === 0, succeeded, failures };
}

/** Bulk "Not a match". */
export async function rejectReconciliationBatch(
  items: { csvTransactionId: string; plaidTransactionId: string }[],
): Promise<void> {
  const repo = makeReconciliationReviewRepo(getDb());
  for (const it of items) repo.markRejected(it.csvTransactionId, it.plaidTransactionId);
  revalidatePath("/reconcile");
}

/** Undo a persisted decision — the pair becomes eligible to suggest again. */
export async function unmarkReconciliation(
  csvTransactionId: string,
  plaidTransactionId: string,
): Promise<void> {
  makeReconciliationReviewRepo(getDb()).unmark(csvTransactionId, plaidTransactionId);
  revalidateReconcilePaths();
}

function errMsg(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return "Unknown error";
}

export interface LinkedCounterpart {
  id: string;
  date: string;
  name: string;
  amount: number;
  accountLabel: string;
}

export interface LinkCandidate {
  id: string;
  date: string;
  name: string;
  amount: number;
  accountLabel: string;
  sameAmount: boolean;
}

// Fetch link info for a transaction: its existing confirmed pair counterparts,
// plus a search-filtered list of opposite-sign candidates within ±180 days.
// Used by the "Linked refund/charge" section of TransactionEditModal.
export async function getRefundLinkInfo(
  txId: string,
  query: string,
): Promise<{ linked: LinkedCounterpart[]; candidates: LinkCandidate[] }> {
  const db = getDb();
  const txRepo = makeTransactionRepo(db);
  const accountRepo = makeAccountRepo(db);
  const matchRepo = makeRefundMatchRepo(db);

  const tx = txRepo.getById(txId);
  if (!tx) return { linked: [], candidates: [] };

  const accountLabelMap = new Map<string, string>(
    accountRepo.list().map((a) => [a.id, formatAccountLabel(a)]),
  );
  const labelOf = (t: { accountId: string | null }) =>
    t.accountId ? accountLabelMap.get(t.accountId) ?? "" : "(manual)";

  // Existing links (confirmed) — return the other side of each.
  const linked: LinkedCounterpart[] = [];
  for (const row of matchRepo.linksForTransaction(txId)) {
    const otherId = row.expenseId === txId ? row.refundId : row.expenseId;
    const other = txRepo.getById(otherId);
    if (!other) continue;
    linked.push({
      id: other.id,
      date: other.date,
      name: other.customName ?? other.name,
      amount: other.amount,
      accountLabel: labelOf(other),
    });
  }

  // Candidates: opposite sign, 180-day window anchored by causality
  // (you can't refund a purchase you haven't made yet, and vice versa) — with
  // 2 days of slack on the "wrong" side because bank posting order isn't
  // always settle-date ordered; a refund + charge at the same merchant can
  // flip by a day or two.
  //   • Refund (positive) → search expenses from tx.date − 180 to tx.date + 2.
  //   • Expense (negative) → search refunds from tx.date − 2 to tx.date + 180.
  // Drop transactions already part of any confirmed pair (either side) — they
  // would create a conflicting link.
  const confirmedTxIds = new Set<string>();
  for (const row of matchRepo.listByStatus("confirmed")) {
    confirmedTxIds.add(row.expenseId);
    confirmedTxIds.add(row.refundId);
  }

  const shiftDate = (iso: string, days: number) => {
    const d = new Date(iso);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  };

  const isRefund = tx.amount > 0;
  const wantOppositeSign = isRefund ? "negative" : "positive";
  const dateMin = isRefund ? shiftDate(tx.date, -180) : shiftDate(tx.date, -2);
  const dateMax = isRefund ? shiftDate(tx.date, 2) : shiftDate(tx.date, 180);

  const all = txRepo.query({ from: dateMin, to: dateMax });
  const q = query.trim().toLowerCase();
  const refundAbs = Math.abs(tx.amount);
  // Default behavior (empty query): narrow to candidates that share the source
  // transaction's canonicalName. Searching overrides — once the user types
  // anything we fall back to the broader opposite-sign list scored by merchant
  // substring / amount match.
  const ownCanonical = (tx.canonicalName ?? "").trim().toLowerCase();
  const defaultByCanonical = q.length === 0 && ownCanonical.length > 0;
  const candidates: LinkCandidate[] = [];
  for (const candidate of all) {
    if (candidate.id === txId) continue;
    if (confirmedTxIds.has(candidate.id)) continue;
    if (wantOppositeSign === "positive" && candidate.amount <= 0) continue;
    if (wantOppositeSign === "negative" && candidate.amount >= 0) continue;
    // A refund cannot exceed the expense it refunds (modulo rare FX swings the
    // user has explicitly opted out of). Drop expenses smaller than the refund.
    if (isRefund && Math.abs(candidate.amount) < refundAbs) continue;
    const merchant = (candidate.customName ?? candidate.name).toLowerCase();
    if (defaultByCanonical) {
      const candidateCanonical = (candidate.canonicalName ?? "").trim().toLowerCase();
      if (candidateCanonical !== ownCanonical) continue;
    } else if (q && !merchant.includes(q) && !String(Math.abs(candidate.amount)).includes(q)) continue;
    candidates.push({
      id: candidate.id,
      date: candidate.date,
      name: candidate.customName ?? candidate.name,
      amount: candidate.amount,
      accountLabel: labelOf(candidate),
      sameAmount: Math.abs(candidate.amount) === Math.abs(tx.amount),
    });
  }

  // Sort: same-amount first, then most recent.
  candidates.sort((a, b) => {
    if (a.sameAmount !== b.sameAmount) return a.sameAmount ? -1 : 1;
    return b.date.localeCompare(a.date);
  });

  return { linked, candidates: candidates.slice(0, 50) };
}

// Manual link from TransactionEditModal. Caller passes two arbitrary tx ids;
// we derive expense vs. refund from amount sign so the picker UI doesn't have
// to. Bypasses the auto-detector's amount/window/account constraints — the
// user knows best (partial refunds, cross-account, etc).
export async function linkRefundManual(aId: string, bId: string): Promise<{ ok: boolean; error?: string }> {
  if (aId === bId) return { ok: false, error: "Cannot link a transaction to itself." };
  const repo = makeTransactionRepo(getDb());
  const a = repo.getById(aId);
  const b = repo.getById(bId);
  if (!a || !b) return { ok: false, error: "Transaction not found." };
  // Determine expense (negative) and refund (positive). If both have the same
  // sign the pairing doesn't make sense — surface the error.
  let expense, refund;
  if (a.amount < 0 && b.amount > 0) { expense = a; refund = b; }
  else if (a.amount > 0 && b.amount < 0) { expense = b; refund = a; }
  else return { ok: false, error: "Linked transactions must have opposite signs." };
  makeRefundMatchRepo(getDb()).confirm(expense.id, refund.id);
  mirrorExpenseFlagsToRefund(expense.id, refund.id);
  revalidateRefundPaths();
  return { ok: true };
}

export async function dismissRecurringMerchant(merchant: string): Promise<void> {
  makeRecurringDismissalRepo(getDb()).dismiss(merchant);
  revalidatePath("/recurring");
}

export async function undismissRecurringMerchant(merchant: string): Promise<void> {
  makeRecurringDismissalRepo(getDb()).undismiss(merchant);
  revalidatePath("/recurring");
}

export async function listRules(): Promise<Rule[]> {
  return makeRuleRepo(getDb()).list();
}

export async function createRule(
  name: string,
  conditions: RuleCondition[],
  actions: RuleAction[],
): Promise<Rule> {
  const rule = makeRuleRepo(getDb()).create(name, conditions, actions);
  revalidatePath("/settings/rules");
  revalidatePath("/trends");
  return rule;
}

export async function updateRule(
  id: string,
  patch: Partial<Pick<Rule, "name" | "enabled" | "conditions" | "actions">>,
): Promise<void> {
  makeRuleRepo(getDb()).update(id, patch);
  revalidatePath("/settings/rules");
  revalidatePath("/trends");
}

export async function deleteRule(id: string): Promise<void> {
  makeRuleRepo(getDb()).remove(id);
  revalidatePath("/settings/rules");
  revalidatePath("/trends");
}

export interface RulePreviewRow {
  id: string;
  date: string;
  name: string;
  category: string;
  amount: number;
  accountLabel: string;
  tags: string[];
}

const PREVIEW_LIMIT = 1000;

export async function previewRuleMatches(
  conditions: RuleCondition[],
): Promise<{ rows: RulePreviewRow[]; total: number; truncated: boolean }> {
  if (conditions.length === 0) return { rows: [], total: 0, truncated: false };
  const db = getDb();
  const txRepo = makeTransactionRepo(db);
  const accountTagMap = makeAccountRepo(db).tagMap();
  const accountsList = makeAccountRepo(db).list();
  const accountLabel = new Map(
    accountsList.map((a) => [a.id, formatAccountLabel(a)]),
  );

  const all = txRepo.query({});
  const matched: { tx: typeof all[number]; mergedTags: string[] }[] = [];
  for (const tx of all) {
    const inherited = tx.accountId ? (accountTagMap.get(tx.accountId) ?? []) : [];
    const mergedTags = [...new Set([...inherited, ...tx.tags])];
    if (matchesAll(conditions, { ...tx, tags: mergedTags })) {
      matched.push({ tx, mergedTags });
    }
  }

  matched.sort((a, b) => (a.tx.date < b.tx.date ? 1 : a.tx.date > b.tx.date ? -1 : 0));
  const truncated = matched.length > PREVIEW_LIMIT;
  const sliced = truncated ? matched.slice(0, PREVIEW_LIMIT) : matched;

  return {
    rows: sliced.map(({ tx, mergedTags }) => ({
      id: tx.id,
      date: tx.date,
      name: tx.customName ?? tx.canonicalName ?? tx.name,
      category: tx.category,
      amount: tx.amount,
      accountLabel: tx.accountId ? (accountLabel.get(tx.accountId) ?? "") : "",
      tags: mergedTags,
    })),
    total: matched.length,
    truncated,
  };
}

export async function applyRuleToTransactions(
  actions: RuleAction[],
  transactionIds: string[],
): Promise<{ applied: number }> {
  if (actions.length === 0 || transactionIds.length === 0) return { applied: 0 };
  const db = getDb();
  const txRepo = makeTransactionRepo(db);

  // Pre-compute simple field assignments. Tag actions are accumulated and
  // resolved per-transaction since they depend on existing tags.
  let setCategory: string | undefined;
  let setCustomName: string | undefined;
  let setCanonicalName: string | undefined;
  let setProfile: string | undefined;
  let exclude: boolean | undefined;
  let markOneTime: boolean | undefined;
  let setTags: string[] | undefined;
  const addTags: string[] = [];
  const removeTags: string[] = [];
  for (const a of actions) {
    if (a.type === "setCategory" && a.value) setCategory = a.value;
    else if (a.type === "setCustomName" && a.value) setCustomName = a.value;
    else if (a.type === "setCanonicalName" && a.value) setCanonicalName = a.value;
    else if (a.type === "setProfile" && a.value) setProfile = a.value;
    else if (a.type === "exclude") exclude = true;
    else if (a.type === "markOneTime") markOneTime = true;
    else if (a.type === "setTags") setTags = a.value ? [a.value] : [];
    else if (a.type === "addTag" && a.value) addTags.push(a.value);
    else if (a.type === "removeTag" && a.value) removeTags.push(a.value);
  }

  // Collect unique (rawName, source) pairs from affected transactions so we
  // can teach merchant_alias the new identity once per pattern, not per row.
  // 'manual' source is skipped — manual entries have no canonical raw pattern
  // to teach the Plaid sync hook with.
  const aliasPatterns = new Map<string, { sourcePattern: string; source: MerchantAliasSourceKind }>();

  let applied = 0;
  for (const id of transactionIds) {
    const existing = txRepo.getById(id);
    if (!existing) continue;

    const patch: TransactionUpdateInput = {};
    if (setCategory !== undefined) patch.category = setCategory;
    if (setCustomName !== undefined) patch.customName = setCustomName;
    if (setCanonicalName !== undefined) patch.canonicalName = setCanonicalName;
    if (setProfile !== undefined) patch.profileId = setProfile;
    if (exclude !== undefined) patch.excluded = exclude;
    if (markOneTime !== undefined) patch.oneTime = markOneTime;
    if (setTags !== undefined || addTags.length || removeTags.length) {
      patch.tags = resolveTags(existing.tags, { setTags, addTags, removeTags });
    }

    txRepo.updateTransaction(id, patch);
    applied += 1;

    if (setCanonicalName !== undefined && existing.name) {
      const aliasSource: MerchantAliasSourceKind | null =
        existing.source === "plaid" ? "plaid" : existing.source === "csv" ? "rocket" : null;
      if (aliasSource) {
        const key = `${aliasSource}::${existing.name}`;
        if (!aliasPatterns.has(key)) {
          aliasPatterns.set(key, { sourcePattern: existing.name, source: aliasSource });
        }
      }
    }
  }

  if (setCanonicalName !== undefined && aliasPatterns.size > 0) {
    const aliasRepo = makeMerchantAliasRepo(db);
    const existingAlias = aliasRepo.get(setCanonicalName);
    if (!existingAlias) {
      aliasRepo.create({
        canonicalName: setCanonicalName,
        defaultCategory: setCategory ?? null,
        confidence: "high",
        sources: [...aliasPatterns.values()].map((p) => ({
          sourcePattern: p.sourcePattern,
          source: p.source,
          matchType: "exact",
        })),
      });
    } else {
      for (const p of aliasPatterns.values()) {
        aliasRepo.addSource(setCanonicalName, p.sourcePattern, p.source, "exact");
      }
    }
  }

  revalidatePath("/settings/rules");
  revalidatePath("/transactions");
  revalidatePath("/trends");
  revalidatePath("/categories");
  return { applied };
}

export async function reorderRules(ids: string[]): Promise<void> {
  makeRuleRepo(getDb()).reorder(ids);
  revalidatePath("/settings/rules");
}

export async function updateTransaction(id: string, input: TransactionUpdateInput): Promise<void> {
  makeTransactionRepo(getDb()).updateTransaction(id, input);
  revalidatePath("/transactions");
  revalidatePath("/trends");
}

export type BulkAction =
  | { type: "setCategory"; value: string }
  | { type: "setCustomName"; value: string }
  | { type: "setCanonicalName"; value: string }
  | { type: "addTag"; tagId: string }
  | { type: "removeTag"; tagId: string }
  | { type: "exclude" }
  | { type: "unexclude" }
  | { type: "markOneTime" }
  | { type: "unmarkOneTime" }
  | { type: "setProfile"; profileId: string };

export async function bulkUpdateTransactions(ids: string[], action: BulkAction): Promise<void> {
  const db = getDb();
  const repo = makeTransactionRepo(db);
  for (const id of ids) {
    switch (action.type) {
      case "setCategory":
        repo.updateTransaction(id, { category: action.value });
        break;
      case "setCustomName":
        repo.updateTransaction(id, { customName: action.value || null });
        break;
      case "setCanonicalName":
        repo.updateTransaction(id, { canonicalName: action.value || null });
        break;
      case "addTag": {
        const tx = repo.getById(id);
        if (!tx) break;
        if (!tx.tags.includes(action.tagId)) {
          repo.updateTransaction(id, { tags: [...tx.tags, action.tagId] });
        }
        break;
      }
      case "removeTag": {
        const tx = repo.getById(id);
        if (!tx) break;
        repo.updateTransaction(id, { tags: tx.tags.filter((t) => t !== action.tagId) });
        break;
      }
      case "exclude":
        repo.updateTransaction(id, { excluded: true });
        break;
      case "unexclude":
        repo.updateTransaction(id, { excluded: false });
        break;
      case "markOneTime":
        repo.updateTransaction(id, { oneTime: true });
        break;
      case "unmarkOneTime":
        repo.updateTransaction(id, { oneTime: false });
        break;
      case "setProfile":
        repo.updateTransaction(id, { profileId: action.profileId });
        break;
    }
  }
  revalidatePath("/transactions");
  revalidatePath("/trends");
  revalidatePath("/categories");
}
