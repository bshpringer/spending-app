import type { Transaction } from "./types.ts";

export interface ConfirmedPair {
  expenseId: string;
  refundId: string;
}

/**
 * Remap confirmed-refund rows so they appear to "live" on the linked expense's
 * date and category for aggregation purposes.
 *
 * The raw `id`, `amount`, `accountId`, and all other fields are unchanged —
 * only `date`, `originalDate`, `category`, `name`, `customName`, and
 * `canonicalName` are overwritten so the existing `bucket -= tx.amount` math
 * in every aggregator naturally nets the refund into the expense's bucket
 * instead of the refund's own bucket.
 *
 * The `txById` map must already include all expense rows referenced by
 * `confirmedPairs` — callers that restrict to a date window must pre-load any
 * out-of-window expense rows (see `preloadExpensesForPairs`).
 *
 * Cross-account refunds: `accountId` is intentionally NOT remapped. The
 * credit-card's spend totals get the netting; the bank-account's ledger keeps
 * the refund row attributed to the correct account.
 */
export function applyRefundNetting(
  txs: Transaction[],
  confirmedPairs: ConfirmedPair[],
): Transaction[] {
  if (confirmedPairs.length === 0) return txs;

  const txById = new Map(txs.map((t) => [t.id, t]));
  // Build refundId → expenseId mapping for quick lookup
  const refundToExpenseId = new Map(confirmedPairs.map((p) => [p.refundId, p.expenseId]));

  return txs.map((t) => {
    const expenseId = refundToExpenseId.get(t.id);
    if (!expenseId) return t; // not a linked refund — unchanged

    const expense = txById.get(expenseId);
    if (!expense) return t; // expense not in this set — leave on own date (shouldn't happen if caller pre-loads)

    return {
      ...t,
      // Move the refund into the expense's time-bucket and category bucket
      date: expense.date,
      originalDate: expense.originalDate,
      category: expense.category,
      // Merchant identity follows the expense so merchant breakdowns aggregate together
      name: expense.name,
      customName: expense.customName,
      canonicalName: expense.canonicalName,
      // accountId intentionally not remapped — per design decision (cross-account netting)
    };
  });
}

/**
 * Given a filtered transaction set and the full confirmed pair list, return
 * any expense rows that are referenced by in-set refunds but are NOT already
 * present in the set. These must be fetched from the DB and merged in so
 * `applyRefundNetting` can remap them correctly.
 *
 * Returns the pair list filtered to only pairs where the refund is in `txSet`
 * (we don't need to pre-load expenses for refunds that aren't in the window).
 */
export function pairsWithRefundsInSet(
  txs: Transaction[],
  allPairs: ConfirmedPair[],
): { pairs: ConfirmedPair[]; missingExpenseIds: string[] } {
  const inSetIds = new Set(txs.map((t) => t.id));
  const pairs: ConfirmedPair[] = [];
  const missingExpenseIds: string[] = [];

  for (const p of allPairs) {
    if (!inSetIds.has(p.refundId)) continue;
    pairs.push(p);
    if (!inSetIds.has(p.expenseId)) {
      missingExpenseIds.push(p.expenseId);
    }
  }
  return { pairs, missingExpenseIds };
}

/**
 * Inverse of `pairsWithRefundsInSet`: when the page is scoped by category or
 * merchant, the refund may live outside the query (different category/merchant
 * than the expense). For each in-set expense with a confirmed pair, return
 * the missing refund ids that need to be pulled in so netting can remap them.
 */
export function pairsWithExpensesInSet(
  txs: Transaction[],
  allPairs: ConfirmedPair[],
): { pairs: ConfirmedPair[]; missingRefundIds: string[] } {
  const inSetIds = new Set(txs.map((t) => t.id));
  const pairs: ConfirmedPair[] = [];
  const missingRefundIds: string[] = [];

  for (const p of allPairs) {
    if (!inSetIds.has(p.expenseId)) continue;
    pairs.push(p);
    if (!inSetIds.has(p.refundId)) {
      missingRefundIds.push(p.refundId);
    }
  }
  return { pairs, missingRefundIds };
}

interface BatchTxFetcher {
  getByIds(ids: string[]): Transaction[];
}
interface PairSource {
  allConfirmedPairs(): ConfirmedPair[];
}

/**
 * Page-level helper: apply refund netting to a raw query result.
 *
 * - `mode: "date-window"` (trends, dashboard): only preload missing *expenses*
 *   for refunds already in the window. Refunds outside the window stay out.
 * - `mode: "scoped"` (categories, merchants): also preload missing *refunds*
 *   linked to in-set expenses, so cross-category/cross-merchant refunds still
 *   net into the expense's bucket.
 *
 * Returns the netted transaction list (with preloaded expenses dropped so they
 * don't double-count) and the list of all confirmed pairs for downstream
 * suppression + linkedRefunds rendering.
 */
export function applyNetting(
  rawTxs: Transaction[],
  txRepo: BatchTxFetcher,
  refundRepo: PairSource,
  mode: "date-window" | "scoped",
): { transactions: Transaction[]; allPairs: ConfirmedPair[]; nettedRefundIds: Set<string> } {
  const allPairs = refundRepo.allConfirmedPairs();

  const fwd = pairsWithRefundsInSet(rawTxs, allPairs);
  const inv = mode === "scoped"
    ? pairsWithExpensesInSet(rawTxs, allPairs)
    : { pairs: [] as ConfirmedPair[], missingRefundIds: [] as string[] };

  const missingExpenseIds = fwd.missingExpenseIds;
  const missingRefundIds = inv.missingRefundIds;
  const extra = txRepo.getByIds([...missingExpenseIds, ...missingRefundIds]);

  // Union of active pairs across both directions
  const seen = new Set<string>();
  const activePairs: ConfirmedPair[] = [];
  for (const p of [...fwd.pairs, ...inv.pairs]) {
    const k = `${p.expenseId}|${p.refundId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    activePairs.push(p);
  }

  const dropAfter = new Set(missingExpenseIds);
  const transactions = applyRefundNetting([...rawTxs, ...extra], activePairs)
    .filter((t) => !dropAfter.has(t.id));

  const nettedRefundIds = new Set(activePairs.map((p) => p.refundId));

  return { transactions, allPairs, nettedRefundIds };
}

interface TxRowLike {
  id: string;
  date: string;
  name: string;
  customName?: string;
  canonicalName?: string;
  category: string;
  amount: number;
  note: string;
  tags: string[];
  excluded: boolean;
  oneTime: boolean;
  accountId: string | null;
  profileId?: string;
}

/**
 * For every confirmed pair whose expense is visible on the page, attach the
 * refund as a child TxRow keyed by expenseId. Uses a single batched DB read.
 * The `markExcluded` predicate lets callers fold in page-specific excluded
 * logic (e.g. an "ignored" category on /categories/[name]).
 */
export function buildLinkedRefundRows(
  visibleExpenseIds: Set<string>,
  allPairs: ConfirmedPair[],
  txRepo: BatchTxFetcher,
  markExcluded?: (t: Transaction) => boolean,
): Map<string, TxRowLike[]> {
  const relevant = allPairs.filter((p) => visibleExpenseIds.has(p.expenseId));
  if (relevant.length === 0) return new Map();

  const refunds = txRepo.getByIds(relevant.map((p) => p.refundId));
  const refundById = new Map(refunds.map((r) => [r.id, r]));

  const out = new Map<string, TxRowLike[]>();
  for (const p of relevant) {
    const r = refundById.get(p.refundId);
    if (!r) continue;
    const row: TxRowLike = {
      id: r.id,
      date: r.originalDate || r.date,
      name: r.name,
      customName: r.customName,
      canonicalName: r.canonicalName,
      category: r.category,
      amount: r.amount,
      note: r.note,
      tags: r.tags,
      excluded: r.userOverrides.excluded === true || (markExcluded?.(r) ?? false),
      oneTime: r.userOverrides.oneTime === true,
      accountId: r.accountId,
      profileId: r.profileId,
    };
    const existing = out.get(p.expenseId) ?? [];
    existing.push(row);
    out.set(p.expenseId, existing);
  }
  return out;
}
