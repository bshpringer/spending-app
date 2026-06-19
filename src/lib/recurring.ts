import { effectiveTransactions } from "./aggregations.ts";
import type { Transaction, Rule, Category } from "./types.ts";

export type Cadence = "weekly" | "biweekly" | "monthly" | "quarterly" | "annual" | "irregular";
export type AmountVariance = "fixed" | "near-fixed" | "variable";
export type RecurringStatus = "active" | "lapsed" | "ended";

export interface RecurringGroup {
  merchant: string;
  category: string;
  cadence: Cadence;
  medianIntervalDays: number;
  occurrenceCount: number;
  firstDate: string;
  lastDate: string;
  expectedNextDate: string;
  status: RecurringStatus;
  meanAmount: number;        // signed; negative = expense
  lastAmount: number;        // signed; amount of the most recent charge
  minAmount: number;         // absolute magnitude (smallest charge)
  maxAmount: number;         // absolute magnitude (largest charge)
  amountStdev: number;       // over absolute magnitudes
  amountVariance: AmountVariance;
  monthlyEquivalent: number; // signed; negative = expense
  transactionIds: string[];
  accountIds: string[];      // unique accounts the merchant has charged via
  confidence: number;        // 0–1
  dismissed: boolean;
}

export interface CadenceWindows {
  weekly: [number, number];
  biweekly: [number, number];
  monthly: [number, number];
  quarterly: [number, number];
  annual: [number, number];
}

export interface DetectOptions {
  minOccurrences?: number;
  minConfidence?: number;
  cadenceWindows?: CadenceWindows;
  today?: string;            // injected for deterministic tests
}

const DEFAULT_CADENCE_WINDOWS: CadenceWindows = {
  weekly: [5, 10],
  biweekly: [11, 18],
  monthly: [25, 35],
  quarterly: [80, 100],
  annual: [350, 380],
};

const MONTH_DAYS = 30.4375;

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function stdevPop(arr: number[]): number {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((s, x) => s + x, 0) / arr.length;
  const variance = arr.reduce((s, x) => s + (x - mean) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

// IQR with a sensible fallback for very small samples (where Q1/Q3 are noisy).
function iqr(arr: number[]): number {
  if (arr.length < 4) {
    if (arr.length < 2) return 0;
    const s = [...arr].sort((a, b) => a - b);
    return s[s.length - 1] - s[0];
  }
  const s = [...arr].sort((a, b) => a - b);
  const q1 = s[Math.floor(s.length * 0.25)];
  const q3 = s[Math.floor(s.length * 0.75)];
  return q3 - q1;
}

function cadenceBucket(med: number, w: CadenceWindows): Cadence {
  if (med >= w.weekly[0] && med <= w.weekly[1]) return "weekly";
  if (med >= w.biweekly[0] && med <= w.biweekly[1]) return "biweekly";
  if (med >= w.monthly[0] && med <= w.monthly[1]) return "monthly";
  if (med >= w.quarterly[0] && med <= w.quarterly[1]) return "quarterly";
  if (med >= w.annual[0] && med <= w.annual[1]) return "annual";
  return "irregular";
}

function addDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  const a = new Date(from + "T00:00:00Z").getTime();
  const b = new Date(to + "T00:00:00Z").getTime();
  return Math.round((b - a) / 86400000);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function detectRecurring(
  transactions: Transaction[],
  rules: Rule[],
  categoryMap: Map<string, Category>,
  accountTagMap: Map<string, string[]>,
  dismissedMerchants: Set<string>,
  options: DetectOptions = {},
): RecurringGroup[] {
  const minOccurrences = options.minOccurrences ?? 2;
  const minConfidence = options.minConfidence ?? 0.25;
  const windows = options.cadenceWindows ?? DEFAULT_CADENCE_WINDOWS;
  const today = options.today ?? new Date().toISOString().slice(0, 10);

  // excludeOneTime: a charge explicitly flagged as one-time can't, by
  // definition, be recurring — and including it badly skews mean/median (e.g.
  // a $15K account-seed transfer pulled into a $1.5K monthly transfer group).
  const effective = effectiveTransactions(transactions, rules, categoryMap, accountTagMap, {
    excludeOneTime: true,
  });
  const expenses = effective.filter((t) => t.amount < 0);

  const groups = new Map<string, Transaction[]>();
  for (const tx of expenses) {
    const merchant = (tx.canonicalName ?? tx.customName ?? tx.name).trim();
    if (!merchant) continue;
    const arr = groups.get(merchant) ?? [];
    arr.push(tx);
    groups.set(merchant, arr);
  }

  const result: RecurringGroup[] = [];
  for (const [merchant, txs] of groups) {
    const sorted = [...txs].sort((a, b) => a.date.localeCompare(b.date));
    // Same-day same-amount dedupe (defense vs. duplicate-transactions bug).
    const deduped: Transaction[] = [];
    for (const tx of sorted) {
      const last = deduped[deduped.length - 1];
      if (last && last.date === tx.date && last.amount === tx.amount) continue;
      deduped.push(tx);
    }
    if (deduped.length < minOccurrences) continue;

    const intervals: number[] = [];
    for (let i = 1; i < deduped.length; i++) {
      intervals.push(daysBetween(deduped[i - 1].date, deduped[i].date));
    }
    const medianInterval = Math.max(1, Math.round(median(intervals)));
    const cadence = cadenceBucket(medianInterval, windows);
    if (cadence === "irregular") continue;

    const amounts = deduped.map((t) => Math.abs(t.amount));
    const meanAbs = amounts.reduce((s, x) => s + x, 0) / amounts.length;
    const sd = stdevPop(amounts);
    const cov = meanAbs > 0 ? sd / meanAbs : 0;
    const amountVariance: AmountVariance =
      cov <= 0.02 ? "fixed" : cov <= 0.15 ? "near-fixed" : "variable";

    const firstDate = deduped[0].date;
    const lastDate = deduped[deduped.length - 1].date;
    const expectedNextDate = addDays(lastDate, medianInterval);
    const daysSinceLast = daysBetween(lastDate, today);
    const status: RecurringStatus =
      daysSinceLast <= medianInterval * 1.5
        ? "active"
        : daysSinceLast <= medianInterval * 2.5
          ? "lapsed"
          : "ended";

    const catCounts = new Map<string, number>();
    for (const t of deduped) {
      const c = t.category || "Uncategorized";
      catCounts.set(c, (catCounts.get(c) ?? 0) + 1);
    }
    const category = [...catCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];

    const accountIds = [...new Set(deduped.map((t) => t.accountId).filter((x): x is string => x !== null))];

    // 2-occurrence groups: IQR from a single interval is meaningless, so fall
    // back to a moderate regularity score and let count/recency dominate.
    const regularity =
      deduped.length >= 3 ? 1 - Math.min(1, iqr(intervals) / Math.max(medianInterval, 1)) : 0.6;
    const countScore = Math.min(1, deduped.length / 6);
    const recencyScore = status === "active" ? 1 : status === "lapsed" ? 0.5 : 0.2;
    const confidence = 0.5 * regularity + 0.3 * countScore + 0.2 * recencyScore;
    if (confidence < minConfidence) continue;

    const monthlyEquivalent = round2(-meanAbs * (MONTH_DAYS / medianInterval));

    result.push({
      merchant,
      category,
      cadence,
      medianIntervalDays: medianInterval,
      occurrenceCount: deduped.length,
      firstDate,
      lastDate,
      expectedNextDate,
      status,
      meanAmount: round2(-meanAbs),
      lastAmount: round2(deduped[deduped.length - 1].amount),
      minAmount: round2(Math.min(...amounts)),
      maxAmount: round2(Math.max(...amounts)),
      amountStdev: round2(sd),
      amountVariance,
      monthlyEquivalent,
      transactionIds: deduped.map((t) => t.id),
      accountIds,
      confidence: round2(confidence),
      dismissed: dismissedMerchants.has(merchant),
    });
  }

  result.sort((a, b) => Math.abs(b.monthlyEquivalent) - Math.abs(a.monthlyEquivalent));
  return result;
}
