import type { Transaction } from "./types.ts";
import { aggregationDate } from "./period.ts";

/**
 * Cross-source reconciliation: pair an old Rocket/CSV transaction with the Plaid
 * transaction that represents the SAME real-world charge, so Plaid's richer
 * fields (counterparties, personal_finance_category, authorized datetime) can
 * enrich the historical CSV row in place.
 *
 * This is the matcher behind the `/reconcile` page. It is deliberately a pure
 * function over two `Transaction[]` arrays — the CSV (committed) side and the
 * Plaid (freshly-pulled / staged, mapped to `Transaction`) side — mirroring
 * `detectRefunds` / `detectDuplicates`. The route/repo layer owns the staging→
 * Transaction mapping and the enrichment write.
 *
 * ── Why two tiers ───────────────────────────────────────────────────────────
 *  • `desc-exact` keys on (accountId, amount, normalized description). In
 *    practice this fires ~never: Plaid and Rocket almost never agree on the raw
 *    description string (Plaid enriches `AMZN MKTP*RT4N` → `Amazon`). Kept as a
 *    cheap, high-precision fast-path, capped at `descExactDayCap` days apart so
 *    a 12-month subscription whose rows share an identical (acct, amount, desc)
 *    key can't mis-pair January's charge with July's.
 *  • `fallback` is the actual workhorse: same (accountId, amount), dates within
 *    `fallbackWindowDays`, closest-date-first, with a merchant fuzz that clears
 *    cross-source name drift (`634 QUICK STOP, INC.` ↔ `Quick Stop Inc.`).
 *
 * Assignment is strict 1:1 — each CSV row claims at most one Plaid row and vice
 * versa. The Plaid-vs-Plaid dedupe (an incoming Plaid row that re-pulls one we
 * already committed) is NOT this matcher's job; the existing staging fuzzy scan
 * handles that. This matcher only owns the Plaid-vs-CSV enrichment subset.
 */

export type ReconcileTier = "desc-exact" | "fallback-high" | "fallback-medium";

export interface ReconcileMatch {
  /** The committed CSV/Rocket row to be enriched. */
  csv: Transaction;
  /** The Plaid row whose rich fields enrich `csv`. */
  plaid: Transaction;
  tier: ReconcileTier;
  daysApart: number;
  reason: string;
}

export interface ReconcileDetectOptions {
  /**
   * Max calendar-day gap for a `desc-exact` match. Default 7. A wider gap inside
   * an identical (acct, amount, desc) collision bucket is almost always a
   * wrong-month mis-pair.
   */
  descExactDayCap?: number;
  /** Max calendar-day gap for a `fallback` match. Default 3. */
  fallbackWindowDays?: number;
}

const DEFAULT_DESC_EXACT_DAY_CAP = 7;
const DEFAULT_FALLBACK_WINDOW_DAYS = 3;

/** NFC-normalize, collapse whitespace, uppercase — the description join key. */
function normDesc(s: string): string {
  return (s || "").normalize("NFC").replace(/\s+/g, " ").trim().toUpperCase();
}

/** Cheap merchant fuzz: collapse to alnum, uppercase. */
function merchantKey(tx: Transaction): string {
  return (tx.customName ?? tx.canonicalName ?? tx.name).replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

/** Matching keys on the canonical (swipe) date so user edits to `date` vs
 *  `originalDate` don't perturb pairing — same rule the rest of the app uses. */
function dayDiff(a: Transaction, b: Transaction): number {
  const ad = new Date(aggregationDate(a) + "T00:00:00Z").getTime();
  const bd = new Date(aggregationDate(b) + "T00:00:00Z").getTime();
  return Math.round(Math.abs(ad - bd) / 86400000);
}

function tripleKey(tx: Transaction): string {
  return `${tx.accountId}|${tx.amount}|${normDesc(tx.description)}`;
}

/** Stable, order-independent key for a CSV↔Plaid pair (for the reviewed set). */
export function reconcilePairKey(csvId: string, plaidId: string): string {
  return `${csvId}|${plaidId}`;
}

function merchantOk(a: string, b: string): boolean {
  return (
    a === b ||
    (a.length >= 4 && b.includes(a)) ||
    (b.length >= 4 && a.includes(b))
  );
}

/**
 * @param csvTxns      committed CSV/Rocket rows (the enrich targets)
 * @param plaidTxns    Plaid rows to reconcile against (freshly pulled / staged)
 * @param reviewedPairs pair keys (`reconcilePairKey`) the user already decided —
 *                      skipped so we don't re-suggest. Backs `reconciliation_reviews`.
 */
export function detectReconciliations(
  csvTxns: Transaction[],
  plaidTxns: Transaction[],
  reviewedPairs: Set<string> = new Set(),
  options: ReconcileDetectOptions = {},
): ReconcileMatch[] {
  const descExactDayCap = options.descExactDayCap ?? DEFAULT_DESC_EXACT_DAY_CAP;
  const fallbackWindowDays = options.fallbackWindowDays ?? DEFAULT_FALLBACK_WINDOW_DAYS;

  const matches: ReconcileMatch[] = [];
  const matchedCsvIds = new Set<string>();
  const matchedPlaidIds = new Set<string>();

  const eligible = (csv: Transaction, plaid: Transaction) =>
    !matchedCsvIds.has(csv.id) &&
    !matchedPlaidIds.has(plaid.id) &&
    !reviewedPairs.has(reconcilePairKey(csv.id, plaid.id));

  // ── Tier 1: desc-exact ──────────────────────────────────────────────────
  // Bucket BOTH sides by the triple key, then assign closest-date-first WITHIN
  // the bucket. Because every pair in a bucket shares an identical amount +
  // description, date proximity is the only signal — so closest-first greedy is
  // the optimal 1:1 assignment for the bucket.
  const csvByTriple = new Map<string, Transaction[]>();
  for (const c of csvTxns) {
    if (!c.accountId || !c.description) continue;
    const k = tripleKey(c);
    (csvByTriple.get(k) ?? csvByTriple.set(k, []).get(k)!).push(c);
  }
  const plaidByTriple = new Map<string, Transaction[]>();
  for (const p of plaidTxns) {
    if (!p.accountId || !p.description) continue;
    const k = tripleKey(p);
    (plaidByTriple.get(k) ?? plaidByTriple.set(k, []).get(k)!).push(p);
  }

  for (const [k, csvBucket] of csvByTriple) {
    const plaidBucket = plaidByTriple.get(k);
    if (!plaidBucket?.length) continue;
    const candidates: { c: Transaction; p: Transaction; daysApart: number }[] = [];
    for (const c of csvBucket) {
      for (const p of plaidBucket) {
        const daysApart = dayDiff(c, p);
        if (daysApart > descExactDayCap) continue;
        candidates.push({ c, p, daysApart });
      }
    }
    candidates.sort(
      (a, b) => a.daysApart - b.daysApart || a.c.id.localeCompare(b.c.id) || a.p.id.localeCompare(b.p.id),
    );
    for (const { c, p, daysApart } of candidates) {
      if (!eligible(c, p)) continue;
      matchedCsvIds.add(c.id);
      matchedPlaidIds.add(p.id);
      matches.push({
        csv: c,
        plaid: p,
        tier: "desc-exact",
        daysApart,
        reason: `identical description, same account & amount, ${dayWord(daysApart)}`,
      });
    }
  }

  // ── Tier 2: fallback (account + amount + date±window, merchant fuzz) ──────
  // Like desc-exact, assign GLOBALLY rather than in CSV-iteration order: build
  // every in-window candidate pair, then claim greedily by (merchant-match,
  // closest-date). Merchant agreement outranks a day of date drift, so a
  // fallback-high pair wins the Plaid row over a closer fallback-medium one.
  const plaidByPair = new Map<string, Transaction[]>();
  for (const p of plaidTxns) {
    if (!p.accountId || matchedPlaidIds.has(p.id)) continue;
    const k = `${p.accountId}|${p.amount}`;
    (plaidByPair.get(k) ?? plaidByPair.set(k, []).get(k)!).push(p);
  }

  const fallbackCandidates: { c: Transaction; p: Transaction; daysApart: number; ok: boolean }[] = [];
  for (const c of csvTxns) {
    if (!c.accountId || matchedCsvIds.has(c.id)) continue;
    for (const p of plaidByPair.get(`${c.accountId}|${c.amount}`) ?? []) {
      if (!eligible(c, p)) continue;
      const daysApart = dayDiff(c, p);
      if (daysApart > fallbackWindowDays) continue;
      fallbackCandidates.push({ c, p, daysApart, ok: merchantOk(merchantKey(c), merchantKey(p)) });
    }
  }
  fallbackCandidates.sort(
    (a, b) =>
      Number(b.ok) - Number(a.ok) ||
      a.daysApart - b.daysApart ||
      a.c.id.localeCompare(b.c.id) ||
      a.p.id.localeCompare(b.p.id),
  );
  for (const { c, p, daysApart, ok } of fallbackCandidates) {
    if (matchedCsvIds.has(c.id) || matchedPlaidIds.has(p.id)) continue;
    matchedCsvIds.add(c.id);
    matchedPlaidIds.add(p.id);
    matches.push({
      csv: c,
      plaid: p,
      tier: ok ? "fallback-high" : "fallback-medium",
      daysApart,
      reason: ok
        ? `same merchant, same account & amount, ${dayWord(daysApart)}`
        : `different merchant string, same account & amount, ${dayWord(daysApart)}`,
    });
  }

  // High-precision first, then closest date, then most recent CSV row.
  const tierRank: Record<ReconcileTier, number> = {
    "desc-exact": 0,
    "fallback-high": 1,
    "fallback-medium": 2,
  };
  matches.sort((a, b) => {
    if (a.tier !== b.tier) return tierRank[a.tier] - tierRank[b.tier];
    if (a.daysApart !== b.daysApart) return a.daysApart - b.daysApart;
    return aggregationDate(b.csv).localeCompare(aggregationDate(a.csv));
  });

  return matches;
}

function dayWord(delta: number): string {
  return delta === 0 ? "same day" : delta === 1 ? "1 day apart" : `${delta} days apart`;
}
