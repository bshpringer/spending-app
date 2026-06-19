import type { Transaction } from "./types.ts";
import { duplicatePairKey } from "./repo/duplicateReviewRepo.ts";

export type DuplicateConfidence = "high" | "low";

export interface DuplicateSuggestion {
  a: Transaction;
  b: Transaction;
  daysApart: number;
  confidence: DuplicateConfidence;
  reason: string;
}

export interface DuplicateDetectOptions {
  /** Max calendar-day gap between the two charges. Default 3. */
  windowDays?: number;
}

const DEFAULT_WINDOW_DAYS = 3;

function merchantKey(tx: Transaction): string {
  return (tx.customName ?? tx.canonicalName ?? tx.name).trim().toLowerCase();
}

function daysBetween(from: string, to: string): number {
  const a = new Date(from + "T00:00:00Z").getTime();
  const b = new Date(to + "T00:00:00Z").getTime();
  return Math.round(Math.abs(b - a) / 86400000);
}

/**
 * Detect duplicate-looking transactions already in the DB.
 *
 * Pairs must share:
 *   - non-null accountId (same account)
 *   - exact `amount` (signed — two -50 charges, not a +50/-50 refund pair)
 *   - dates within ±windowDays
 *
 * Confidence:
 *   - `high` — same merchant key (post customName/canonicalName resolution)
 *   - `low`  — different merchant strings (worth a look but more likely two
 *             real coincident charges)
 *
 * `keptPairs` is the set of canonical pair keys the user has already reviewed
 * and marked as "both real" — filtered out so we don't re-suggest forever.
 *
 * Excludes transactions with `userOverrides.excluded === true` (already hidden
 * from money math; the user has effectively handled them).
 */
export function detectDuplicates(
  transactions: Transaction[],
  keptPairs: Set<string>,
  options: DuplicateDetectOptions = {},
): DuplicateSuggestion[] {
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;

  // Group by (accountId, amount) — both must match exactly to be a candidate.
  const buckets = new Map<string, Transaction[]>();
  for (const tx of transactions) {
    if (!tx.accountId) continue;
    if (tx.userOverrides?.excluded) continue;
    const key = `${tx.accountId}|${tx.amount}`;
    const arr = buckets.get(key) ?? [];
    arr.push(tx);
    buckets.set(key, arr);
  }

  const out: DuplicateSuggestion[] = [];
  for (const group of buckets.values()) {
    if (group.length < 2) continue;
    // Sort by date so we can short-circuit once the window opens.
    group.sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        const delta = daysBetween(a.date, b.date);
        if (delta > windowDays) break; // sorted — further j's only get larger
        const [x, y] = duplicatePairKey(a.id, b.id);
        if (keptPairs.has(`${x}|${y}`)) continue;
        const sameMerchant = merchantKey(a) === merchantKey(b);
        const confidence: DuplicateConfidence = sameMerchant ? "high" : "low";
        const dayWord = delta === 0 ? "same day" : delta === 1 ? "1 day apart" : `${delta} days apart`;
        const reason = sameMerchant
          ? `same merchant, same account, exact amount, ${dayWord}`
          : `different merchant, same account, exact amount, ${dayWord}`;
        out.push({ a, b, daysApart: delta, confidence, reason });
      }
    }
  }

  // High confidence first, then most recent pair.
  out.sort((p, q) => {
    if (p.confidence !== q.confidence) return p.confidence === "high" ? -1 : 1;
    const pLatest = p.a.date > p.b.date ? p.a.date : p.b.date;
    const qLatest = q.a.date > q.b.date ? q.a.date : q.b.date;
    return qLatest.localeCompare(pLatest);
  });

  return out;
}
