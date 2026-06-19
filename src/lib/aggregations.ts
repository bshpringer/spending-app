import { evaluateRules, resolveTags } from "./evaluate.ts";
import { periodKeyFor, aggregationDate } from "./period.ts";
import type { Granularity } from "./period.ts";
import type {
  Transaction,
  Rule,
  Category,
  MonthlyTotal,
  PeriodTotal,
  CategoryTotal,
  TagTotal,
  MerchantTotal,
} from "./types.ts";

interface ApplyOpts {
  excludeOneTime?: boolean;
}

/**
 * Resolve a transaction through active rules + category classification.
 * Returns null if the transaction should be excluded from aggregations.
 * opts.excludeOneTime: also drops one-time/anomaly transactions (default false).
 */
function applyRules(
  tx: Transaction,
  rules: Rule[],
  categoryMap: Map<string, Category>,
  accountTagMap: Map<string, string[]>,
  opts: ApplyOpts = {},
): Transaction | null {
  // Merge inherited account tags so rule `tag` conditions work correctly
  const inheritedTags = tx.accountId ? (accountTagMap.get(tx.accountId) ?? []) : [];
  const allTags = [...new Set([...inheritedTags, ...tx.tags])];
  const effects = evaluateRules(rules, { ...tx, tags: allTags });

  if (effects.exclude || tx.userOverrides?.excluded) return null;

  const effectiveCategory = effects.category ?? tx.category;
  if (categoryMap.get(effectiveCategory)?.classification === "ignored") return null;

  if (opts.excludeOneTime && (effects.oneTime || tx.userOverrides?.oneTime)) return null;

  return {
    ...tx,
    tags: resolveTags(allTags, effects),
    category: effectiveCategory,
    customName: effects.customName ?? tx.customName,
    canonicalName: effects.canonicalName ?? tx.canonicalName,
    profileId: effects.profileId ?? tx.profileId,
  };
}

export function effectiveTransactions(
  transactions: Transaction[],
  rules: Rule[],
  categoryMap: Map<string, Category>,
  accountTagMap: Map<string, string[]>,
  opts: ApplyOpts = {},
): Transaction[] {
  const result: Transaction[] = [];
  for (const tx of transactions) {
    const effective = applyRules(tx, rules, categoryMap, accountTagMap, opts);
    if (effective) result.push(effective);
  }
  return result;
}

// computeMonthlyTotals excludes one-time transactions by default so the trend
// chart shows normalized monthly spending. Pass excludeOneTime:false to include them.
export function computeMonthlyTotals(
  transactions: Transaction[],
  rules: Rule[],
  categoryMap: Map<string, Category>,
  accountTagMap: Map<string, string[]>,
  opts: ApplyOpts = { excludeOneTime: true },
): MonthlyTotal[] {
  const effective = effectiveTransactions(transactions, rules, categoryMap, accountTagMap, opts);

  const byMonth = new Map<string, { income: number; spend: number }>();
  for (const tx of effective) {
    const month = aggregationDate(tx).slice(0, 7); // YYYY-MM
    const bucket = byMonth.get(month) ?? { income: 0, spend: 0 };
    
    const classification = categoryMap.get(tx.category || "Uncategorized")?.classification;
    if (classification === "income") {
      bucket.income += tx.amount; // Net positive for income
    } else {
      bucket.spend -= tx.amount; // tx.amount is usually negative, so -(-amount) adds to spend. Refunds (+amount) subtract from spend.
    }
    
    byMonth.set(month, bucket);
  }

  return [...byMonth.entries()]
    .map(([month, { income, spend }]) => ({
      month,
      income: Math.round(income * 100) / 100,
      spend: Math.round(Math.abs(spend) * 100) / 100,
    }))
    .sort((a, b) => b.month.localeCompare(a.month))
    .slice(0, 24);
}

export function computeCategoryBreakdown(
  transactions: Transaction[],
  month: string,
  rules: Rule[],
  categoryMap: Map<string, Category>,
  accountTagMap: Map<string, string[]>,
  mode: "expense" | "income" = "expense",
  opts: ApplyOpts = { excludeOneTime: false },
): CategoryTotal[] {
  const inMonth = transactions.filter((tx) => aggregationDate(tx).startsWith(month));
  // Category totals include one-time purchases by default unless overridden.
  const effective = effectiveTransactions(inMonth, rules, categoryMap, accountTagMap, opts);

  const byCategory = new Map<string, { total: number; count: number }>();

  // For income view, seed every income-classified category with $0 so the user
  // sees a complete picture (including categories with no activity this month).
  if (mode === "income") {
    for (const cat of categoryMap.values()) {
      if (cat.classification === "income") {
        byCategory.set(cat.displayName, { total: 0, count: 0 });
      }
    }
  }

  for (const tx of effective) {
    const cat = tx.category || "Uncategorized";
    const classification = categoryMap.get(cat)?.classification;

    if (mode === "expense") {
      if (classification === "income") continue;
    } else {
      if (classification !== "income") continue;
    }

    const bucket = byCategory.get(cat) ?? { total: 0, count: 0 };
    if (mode === "expense") {
      bucket.total -= tx.amount; // Expenses (negative amount) add to total. Refunds subtract.
    } else {
      bucket.total += tx.amount; // Income (positive amount) adds to total.
    }
    bucket.count += 1;
    byCategory.set(cat, bucket);
  }

  return [...byCategory.entries()]
    .map(([category, { total, count }]) => {
      const catDef = categoryMap.get(category);
      return {
        category,
        total: Math.round(total * 100) / 100,
        count,
        color: catDef?.color || undefined,
        icon: catDef?.icon || undefined,
      };
    })
    .sort((a, b) => b.total - a.total);
}

export function computeMerchantBreakdown(
  transactions: Transaction[],
  month: string | null,
  rules: Rule[],
  categoryMap: Map<string, Category>,
  accountTagMap: Map<string, string[]>,
  limit: number | null = 10,
  opts: ApplyOpts = { excludeOneTime: false },
): MerchantTotal[] {
  const windowed = month ? transactions.filter((tx) => aggregationDate(tx).startsWith(month)) : transactions;
  // Merchant totals include one-time purchases by default unless overridden.
  const effective = effectiveTransactions(windowed, rules, categoryMap, accountTagMap, opts);
  const byMerchant = new Map<string, { total: number; count: number }>();
  for (const tx of effective) {
    const classification = categoryMap.get(tx.category || "Uncategorized")?.classification;
    if (classification === "income") continue; // Exclude income categories from merchant breakdown entirely

    const merchant = (tx.canonicalName ?? tx.customName ?? tx.name).trim();
    if (!merchant) continue;
    const bucket = byMerchant.get(merchant) ?? { total: 0, count: 0 };
    bucket.total -= tx.amount; // Sum net expenses
    bucket.count += 1;
    byMerchant.set(merchant, bucket);
  }

  const sorted = [...byMerchant.entries()]
    .map(([merchant, { total, count }]) => ({
      merchant,
      total: Math.round(total * 100) / 100,
      count,
    }))
    .sort((a, b) => b.total - a.total);

  return limit === null ? sorted : sorted.slice(0, limit);
}

export interface CategoryIndexTotals {
  count: number;
  expense: number;
  income: number;
}

/**
 * Per-category totals for `/categories` index. Applies rules and drops excluded
 * transactions, but includes one-time purchases (they are real spending).
 */
export function computeCategoryIndexTotals(
  transactions: Transaction[],
  rules: Rule[],
  categoryMap: Map<string, Category>,
  accountTagMap: Map<string, string[]>,
): Map<string, CategoryIndexTotals> {
  const effective = effectiveTransactions(transactions, rules, categoryMap, accountTagMap, { excludeOneTime: false });
  const byCategory = new Map<string, CategoryIndexTotals>();
  for (const tx of effective) {
    const key = tx.category || "";
    const bucket = byCategory.get(key) ?? { count: 0, expense: 0, income: 0 };
    bucket.count += 1;
    
    const classification = categoryMap.get(key || "Uncategorized")?.classification;
    if (classification === "income") {
      bucket.income += tx.amount;
    } else {
      bucket.expense -= tx.amount;
    }
    
    byCategory.set(key, bucket);
  }
  return byCategory;
}

export function computeTagBreakdown(
  transactions: Transaction[],
  month: string,
  rules: Rule[],
  categoryMap: Map<string, Category>,
  accountTagMap: Map<string, string[]>,
  opts: ApplyOpts = { excludeOneTime: false },
): TagTotal[] {
  const inMonth = transactions.filter((tx) => aggregationDate(tx).startsWith(month));
  const effective = effectiveTransactions(inMonth, rules, categoryMap, accountTagMap, opts);
  // Tags overlap: a transaction in multiple tag buckets contributes to each
  const byTag = new Map<string, { total: number; ids: Set<string> }>();

  function bump(tag: string, tx: Transaction) {
    const bucket = byTag.get(tag) ?? { total: 0, ids: new Set() };
    if (!bucket.ids.has(tx.id)) {
      bucket.total -= tx.amount; // net expense
      bucket.ids.add(tx.id);
    }
    byTag.set(tag, bucket);
  }

  for (const tx of effective) {
    const classification = categoryMap.get(tx.category || "Uncategorized")?.classification;
    if (classification === "income") continue; // Exclude income categories

    if (tx.tags.length === 0) {
      bump("untagged", tx);
    } else {
      for (const tag of tx.tags) bump(tag, tx);
    }
  }

  return [...byTag.entries()]
    .map(([tag, { total, ids }]) => ({
      tag,
      total: Math.round(total * 100) / 100,
      count: ids.size,
    }))
    .sort((a, b) => b.total - a.total);
}

/**
 * For the dashboard bar chart: computes one-time-only spending per month
 * so the UI can show an annotation when one-time items were hidden.
 * Returns a map of YYYY-MM → total one-time expense amount (positive).
 */
export function computeOneTimeByMonth(
  transactions: Transaction[],
  rules: Rule[],
  categoryMap: Map<string, Category>,
  accountTagMap: Map<string, string[]>,
): Map<string, number> {
  // Get transactions that pass excluded-filter but would be dropped by oneTime filter
  const withoutOneTimeFilter = effectiveTransactions(transactions, rules, categoryMap, accountTagMap, { excludeOneTime: false });
  const withOneTimeFilter = new Set(
    effectiveTransactions(transactions, rules, categoryMap, accountTagMap, { excludeOneTime: true }).map((t) => t.id)
  );

  const byMonth = new Map<string, number>();
  for (const tx of withoutOneTimeFilter) {
    if (!withOneTimeFilter.has(tx.id)) {
      const classification = categoryMap.get(tx.category || "Uncategorized")?.classification;
      if (classification !== "income") {
        const month = aggregationDate(tx).slice(0, 7);
        byMonth.set(month, (byMonth.get(month) ?? 0) - tx.amount);
      }
    }
  }
  return byMonth;
}

export interface MerchantIndexItem {
  merchant: string;
  count: number;
  totalSpent: number;
  totalReceived: number;
  net: number;
  avgPerMonth: number;
  topCategory: string | null;
  topCategoryColor: string | null;
  topCategoryIcon: string | null;
  firstSeen: string | null;
  lastSeen: string | null;
  sparkMonths: string[];
  sparkValues: number[];
}

/**
 * Per-merchant totals for `/merchants` index. Mirrors computeMerchantBreakdown's
 * scope (excludes income-classified categories) but produces richer stats and a
 * 12-month sparkline keyed to the most recent months present in the filtered data.
 */
export function computeMerchantIndex(
  transactions: Transaction[],
  rules: Rule[],
  categoryMap: Map<string, Category>,
  accountTagMap: Map<string, string[]>,
  opts: ApplyOpts = { excludeOneTime: false },
): MerchantIndexItem[] {
  const effective = effectiveTransactions(transactions, rules, categoryMap, accountTagMap, opts);

  const monthsInData = new Set<string>();
  for (const tx of effective) monthsInData.add(aggregationDate(tx).slice(0, 7));
  const sortedMonths = [...monthsInData].sort();
  const sparkMonths = sortedMonths.slice(-12);
  const sparkIdx = new Map(sparkMonths.map((m, i) => [m, i]));

  interface Bucket {
    count: number;
    totalSpent: number;
    totalReceived: number;
    monthsHit: Set<string>;
    firstSeen: string | null;
    lastSeen: string | null;
    categoryCounts: Map<string, number>;
    spark: number[];
  }
  const byMerchant = new Map<string, Bucket>();

  for (const tx of effective) {
    const classification = categoryMap.get(tx.category || "Uncategorized")?.classification;
    if (classification === "income") continue;

    const merchant = (tx.canonicalName ?? tx.customName ?? tx.name).trim();
    if (!merchant) continue;

    let b = byMerchant.get(merchant);
    if (!b) {
      b = {
        count: 0,
        totalSpent: 0,
        totalReceived: 0,
        monthsHit: new Set(),
        firstSeen: null,
        lastSeen: null,
        categoryCounts: new Map(),
        spark: new Array(sparkMonths.length).fill(0),
      };
      byMerchant.set(merchant, b);
    }

    b.count += 1;
    if (tx.amount < 0) b.totalSpent += -tx.amount;
    else b.totalReceived += tx.amount;

    const month = aggregationDate(tx).slice(0, 7);
    b.monthsHit.add(month);
    const aggDate = aggregationDate(tx);
    if (!b.firstSeen || aggDate < b.firstSeen) b.firstSeen = aggDate;
    if (!b.lastSeen || aggDate > b.lastSeen) b.lastSeen = aggDate;

    const cat = tx.category || "Uncategorized";
    b.categoryCounts.set(cat, (b.categoryCounts.get(cat) ?? 0) + 1);

    const idx = sparkIdx.get(month);
    if (idx !== undefined) b.spark[idx] += -tx.amount;
  }

  const totalMonthsInRange = Math.max(sortedMonths.length, 1);

  const items: MerchantIndexItem[] = [];
  for (const [merchant, b] of byMerchant) {
    let topCategory: string | null = null;
    let topCount = 0;
    for (const [cat, n] of b.categoryCounts) {
      if (n > topCount) {
        topCount = n;
        topCategory = cat;
      }
    }
    const catDef = topCategory ? categoryMap.get(topCategory) : undefined;
    // Standard sign convention: negative = net spend, positive = net receive.
    const net = b.totalReceived - b.totalSpent;
    items.push({
      merchant,
      count: b.count,
      totalSpent: Math.round(b.totalSpent * 100) / 100,
      totalReceived: Math.round(b.totalReceived * 100) / 100,
      net: Math.round(net * 100) / 100,
      avgPerMonth: Math.round((net / totalMonthsInRange) * 100) / 100,
      topCategory,
      topCategoryColor: catDef?.color ?? null,
      topCategoryIcon: catDef?.icon ?? null,
      firstSeen: b.firstSeen,
      lastSeen: b.lastSeen,
      sparkMonths,
      sparkValues: b.spark.map((v) => Math.round(v * 100) / 100),
    });
  }

  // Default sort puts biggest net spenders first (most negative).
  return items.sort((a, b) => a.net - b.net);
}

// ── Period-generalized aggregations ─────────────────────────────────

/**
 * Generalized version of computeMonthlyTotals — buckets by any Granularity.
 * Returns PeriodTotal[] sorted DESC by period key. No slicing — callers decide
 * how many periods to show.
 */
export function computePeriodTotals(
  transactions: Transaction[],
  granularity: Granularity,
  rules: Rule[],
  categoryMap: Map<string, Category>,
  accountTagMap: Map<string, string[]>,
  opts: ApplyOpts = { excludeOneTime: true },
  nettedRefundIds: Set<string> = new Set(),
): PeriodTotal[] {
  const effective = effectiveTransactions(transactions, rules, categoryMap, accountTagMap, opts);

  const byPeriod = new Map<string, { income: number; spend: number }>();
  for (const tx of effective) {
    const period = periodKeyFor(aggregationDate(tx), granularity);
    const bucket = byPeriod.get(period) ?? { income: 0, spend: 0 };

    const classification = categoryMap.get(tx.category || "Uncategorized")?.classification;
    if (classification === "income") {
      bucket.income += tx.amount;
    } else {
      // Spend-only: drop positive amounts unless this row is a netted refund.
      if (tx.amount > 0 && !nettedRefundIds.has(tx.id)) {
        byPeriod.set(period, bucket);
        continue;
      }
      bucket.spend -= tx.amount;
    }

    byPeriod.set(period, bucket);
  }

  return [...byPeriod.entries()]
    .map(([period, { income, spend }]) => ({
      period,
      income: Math.round(income * 100) / 100,
      spend: Math.round(Math.abs(spend) * 100) / 100,
    }))
    .sort((a, b) => b.period.localeCompare(a.period));
}

/**
 * Category breakdown for a given period key + granularity.
 * Generalizes computeCategoryBreakdown (which uses month = tx.date.startsWith).
 */
export function computeCategoryBreakdownForPeriod(
  transactions: Transaction[],
  period: string,
  granularity: Granularity,
  rules: Rule[],
  categoryMap: Map<string, Category>,
  accountTagMap: Map<string, string[]>,
  mode: "expense" | "income" = "expense",
  opts: ApplyOpts = { excludeOneTime: false },
  nettedRefundIds: Set<string> = new Set(),
): CategoryTotal[] {
  const inPeriod = transactions.filter((tx) => periodKeyFor(aggregationDate(tx), granularity) === period);
  const effective = effectiveTransactions(inPeriod, rules, categoryMap, accountTagMap, opts);

  const byCategory = new Map<string, { total: number; count: number }>();

  if (mode === "income") {
    for (const cat of categoryMap.values()) {
      if (cat.classification === "income") {
        byCategory.set(cat.displayName, { total: 0, count: 0 });
      }
    }
  }

  for (const tx of effective) {
    const cat = tx.category || "Uncategorized";
    const classification = categoryMap.get(cat)?.classification;

    if (mode === "expense") {
      if (classification === "income") continue;
      // Spend-only: drop positive amounts unless this row is a netted refund.
      if (tx.amount > 0 && !nettedRefundIds.has(tx.id)) continue;
    } else {
      if (classification !== "income") continue;
    }

    const bucket = byCategory.get(cat) ?? { total: 0, count: 0 };
    if (mode === "expense") {
      bucket.total -= tx.amount;
    } else {
      bucket.total += tx.amount;
    }
    bucket.count += 1;
    byCategory.set(cat, bucket);
  }

  return [...byCategory.entries()]
    .map(([category, { total, count }]) => {
      const catDef = categoryMap.get(category);
      return {
        category,
        total: Math.round(total * 100) / 100,
        count,
        color: catDef?.color || undefined,
        icon: catDef?.icon || undefined,
      };
    })
    .sort((a, b) => b.total - a.total);
}

/**
 * Tag breakdown for a given period key + granularity.
 * Generalizes computeTagBreakdown.
 */
export function computeTagBreakdownForPeriod(
  transactions: Transaction[],
  period: string,
  granularity: Granularity,
  rules: Rule[],
  categoryMap: Map<string, Category>,
  accountTagMap: Map<string, string[]>,
  opts: ApplyOpts = { excludeOneTime: false },
  nettedRefundIds: Set<string> = new Set(),
): TagTotal[] {
  const inPeriod = transactions.filter((tx) => periodKeyFor(aggregationDate(tx), granularity) === period);
  const effective = effectiveTransactions(inPeriod, rules, categoryMap, accountTagMap, opts);
  const byTag = new Map<string, { total: number; ids: Set<string> }>();

  function bump(tag: string, tx: Transaction) {
    const bucket = byTag.get(tag) ?? { total: 0, ids: new Set() };
    if (!bucket.ids.has(tx.id)) {
      bucket.total -= tx.amount;
      bucket.ids.add(tx.id);
    }
    byTag.set(tag, bucket);
  }

  for (const tx of effective) {
    const classification = categoryMap.get(tx.category || "Uncategorized")?.classification;
    if (classification === "income") continue;
    // Spend-only: drop positive amounts unless this row is a netted refund.
    if (tx.amount > 0 && !nettedRefundIds.has(tx.id)) continue;

    if (tx.tags.length === 0) {
      bump("untagged", tx);
    } else {
      for (const tag of tx.tags) bump(tag, tx);
    }
  }

  return [...byTag.entries()]
    .map(([tag, { total, ids }]) => ({
      tag,
      total: Math.round(total * 100) / 100,
      count: ids.size,
    }))
    .sort((a, b) => b.total - a.total);
}

/**
 * Merchant breakdown for a given period key + granularity.
 * Generalizes computeMerchantBreakdown. Pass period=null for all-time.
 */
export function computeMerchantBreakdownForPeriod(
  transactions: Transaction[],
  period: string | null,
  granularity: Granularity,
  rules: Rule[],
  categoryMap: Map<string, Category>,
  accountTagMap: Map<string, string[]>,
  limit: number | null = 10,
  opts: ApplyOpts = { excludeOneTime: false },
): MerchantTotal[] {
  const windowed = period ? transactions.filter((tx) => periodKeyFor(aggregationDate(tx), granularity) === period) : transactions;
  const effective = effectiveTransactions(windowed, rules, categoryMap, accountTagMap, opts);
  const byMerchant = new Map<string, { total: number; count: number }>();
  for (const tx of effective) {
    const classification = categoryMap.get(tx.category || "Uncategorized")?.classification;
    if (classification === "income") continue;

    const merchant = (tx.canonicalName ?? tx.customName ?? tx.name).trim();
    if (!merchant) continue;
    const bucket = byMerchant.get(merchant) ?? { total: 0, count: 0 };
    bucket.total -= tx.amount;
    bucket.count += 1;
    byMerchant.set(merchant, bucket);
  }

  const sorted = [...byMerchant.entries()]
    .map(([merchant, { total, count }]) => ({
      merchant,
      total: Math.round(total * 100) / 100,
      count,
    }))
    .sort((a, b) => b.total - a.total);

  return limit === null ? sorted : sorted.slice(0, limit);
}

/**
 * One-time spending per period (generalizes computeOneTimeByMonth).
 * Returns a map of periodKey → total one-time expense amount (positive).
 */
export function computeOneTimeByPeriod(
  transactions: Transaction[],
  granularity: Granularity,
  rules: Rule[],
  categoryMap: Map<string, Category>,
  accountTagMap: Map<string, string[]>,
): Map<string, number> {
  const withoutOneTimeFilter = effectiveTransactions(transactions, rules, categoryMap, accountTagMap, { excludeOneTime: false });
  const withOneTimeFilter = new Set(
    effectiveTransactions(transactions, rules, categoryMap, accountTagMap, { excludeOneTime: true }).map((t) => t.id)
  );

  const byPeriod = new Map<string, number>();
  for (const tx of withoutOneTimeFilter) {
    if (!withOneTimeFilter.has(tx.id)) {
      const classification = categoryMap.get(tx.category || "Uncategorized")?.classification;
      if (classification !== "income") {
        const period = periodKeyFor(aggregationDate(tx), granularity);
        byPeriod.set(period, (byPeriod.get(period) ?? 0) - tx.amount);
      }
    }
  }
  return byPeriod;
}
