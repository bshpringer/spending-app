import type {
  MerchantAliasConfidence,
  PlaidStagingRow,
  ReconcileCandidate,
  ReconcilePreviewRow,
  Transaction,
} from "./types.ts";

// Confidence thresholds (sum of signals). Tune after a real run.
const HIGH_THRESHOLD = 8;
const MEDIUM_THRESHOLD = 5;

// Hard cap on rows serialized per cluster preview. The wizard UI defaults to
// showing the first PREVIEW_INITIAL but lets the user expand to see up to
// this many. Avoids shipping enormous payloads for paycheck-style clusters
// with hundreds of rows.
const PREVIEW_LIMIT = 500;

// Common boilerplate prefixes that appear in raw bank descriptions and obscure
// the real merchant. Stripped during normalization so the residual merchant
// stem aligns across sources.
const STRIPPED_PREFIXES = [
  "sq *",
  "sq*",
  "tst*",
  "tst *",
  "pp*",
  "pp *",
  "paypal *",
  "amzn mktp us*",
  "amzn mktp us",
  "amzn mktp",
  "amazon mktpl",
  "amazon.com*",
  "amazon.com",
  "amazon mktp",
  "doordash*",
  "uber *",
  "uber*",
  "lyft *",
  "lyft*",
  "venmo*",
  "venmo *",
  "cash app*",
];

// Tokens we strip out wholesale because they're noise (mask suffixes, store
// numbers, etc). Each is removed wherever it appears.
const NOISE_TOKEN_RE = [
  /\*\w+$/g, // *MASK suffix
  /#\d+/g,
  /\b\d{4,}\b/g, // long digit runs (store numbers, masks)
  /\b\d{3,}\b$/g, // trailing 3+ digits
];

/**
 * Normalize a raw merchant string into a stable stem we can use as a cluster
 * key. Best-effort, not perfect — designed to collapse variants of the same
 * underlying merchant string (e.g. "AMZN MKTP US*RT4N81234" → "amazon mktpl";
 * "CITI AUTOPAY DES:PAYMENT ID:XYZ123 INDN:..." → "citi autopay").
 */
export function normalizeMerchantStem(raw: string): string {
  let s = raw.trim().toLowerCase();
  // ACH descriptors: bank statements often glue the merchant name to metadata
  // via tokens like "DES:PAYMENT", "ID:XYZ", "INDN:JOHN DOE", "CO ID:ACME".
  // Everything from the first `word:nospace-word` token onward is metadata.
  // The `:\S` lookahead distinguishes "DES:PAYMENT" (ACH) from a merchant
  // name with a colon followed by a space like "Joe's: The Best Burgers".
  const colonIdx = s.search(/\b\w+:\S/);
  if (colonIdx > 0) s = s.slice(0, colonIdx).trim();
  // Strip common prefixes (longest first to win)
  const prefixes = [...STRIPPED_PREFIXES].sort((a, b) => b.length - a.length);
  for (const p of prefixes) {
    if (s.startsWith(p)) {
      s = s.slice(p.length).trim();
      break;
    }
  }
  for (const re of NOISE_TOKEN_RE) {
    s = s.replace(re, " ");
  }
  // Drop mixed-alpha-digit tokens of 6+ chars — these are almost always
  // transaction IDs / mask codes (e.g. "KP02A8Z23", "X89F81BF3") that the
  // \d{4,} rule above doesn't catch because they have both letters and digits.
  s = s.replace(/\b(?=[a-z0-9]*[a-z])(?=[a-z0-9]*\d)[a-z0-9]{6,}\b/g, " ");
  // Collapse separators, drop punctuation
  s = s.replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  return s;
}

interface Cluster<TRow> {
  stem: string;
  rows: TRow[];
}

function clusterBy<TRow>(rows: TRow[], stemOf: (r: TRow) => string): Map<string, Cluster<TRow>> {
  const map = new Map<string, Cluster<TRow>>();
  for (const r of rows) {
    const stem = stemOf(r);
    if (!stem) continue;
    let bucket = map.get(stem);
    if (!bucket) {
      bucket = { stem, rows: [] };
      map.set(stem, bucket);
    }
    bucket.rows.push(r);
  }
  return map;
}

function rocketMerchantKey(t: Transaction): string {
  return (t.customName ?? t.canonicalName ?? t.name).trim();
}

function plaidMerchantKey(r: PlaidStagingRow): string {
  return (r.canonicalName ?? r.name).trim();
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[m - 1] + sorted[m]) / 2 : sorted[m];
}

function mode<T>(items: T[]): T | null {
  if (items.length === 0) return null;
  const counts = new Map<T, number>();
  for (const i of items) counts.set(i, (counts.get(i) ?? 0) + 1);
  let best: T | null = null;
  let bestCount = -1;
  for (const [k, c] of counts) {
    if (c > bestCount) {
      best = k;
      bestCount = c;
    }
  }
  return best;
}

function shareTokens(a: string, b: string): number {
  const aTokens = new Set(a.split(" ").filter((t) => t.length >= 3));
  const bTokens = new Set(b.split(" ").filter((t) => t.length >= 3));
  let n = 0;
  for (const t of aTokens) if (bTokens.has(t)) n++;
  return n;
}

function dateSpan(dates: string[]): { from: string; to: string } | null {
  if (dates.length === 0) return null;
  const sorted = [...dates].sort();
  return { from: sorted[0], to: sorted[sorted.length - 1] };
}

function rangesOverlap(a: { from: string; to: string }, b: { from: string; to: string }): boolean {
  return a.from <= b.to && b.from <= a.to;
}

function buildPreview(rocket: Transaction[]): ReconcilePreviewRow[] {
  return rocket
    .slice(0, PREVIEW_LIMIT)
    .map((t) => ({
      date: t.date,
      rawName: t.customName ?? t.canonicalName ?? t.name,
      amount: t.amount,
      category: t.category,
      accountId: t.accountId,
    }));
}

function buildPreviewPlaid(plaid: PlaidStagingRow[]): ReconcilePreviewRow[] {
  return plaid.slice(0, PREVIEW_LIMIT).map((r) => ({
    date: r.date,
    rawName: r.canonicalName ?? r.name,
    amount: r.amount,
    category: r.category,
    accountId: r.accountId,
  }));
}

function chooseCanonicalName(rocket: Transaction[], plaid: PlaidStagingRow[]): string {
  // Plaid pre-enriches merchant names — prefer it when present.
  const plaidNames = plaid.map((r) => r.name.trim()).filter(Boolean);
  const plaidMode = mode(plaidNames);
  if (plaidMode) return plaidMode;
  // Fall back to whichever Rocket name appears most.
  const rocketNames = rocket.map((t) => (t.customName ?? t.canonicalName ?? t.name).trim()).filter(Boolean);
  const rocketMode = mode(rocketNames);
  return rocketMode ?? "";
}

function chooseDefaultCategory(rocket: Transaction[], plaid: PlaidStagingRow[]): string | null {
  // Rocket categories are user-tuned ground truth — use them first.
  const rocketCats = rocket
    .map((t) => t.userOverrides?.category ?? t.category)
    .filter((c): c is string => !!c && c.length > 0 && c.toLowerCase() !== "uncategorized");
  const rocketMode = mode(rocketCats);
  if (rocketMode) return rocketMode;
  // Only fall back to Plaid's enriched category if Rocket has nothing useful.
  const plaidCats = plaid.map((r) => r.category).filter((c): c is string => !!c && c.length > 0);
  return mode(plaidCats);
}

export interface ProposeOptions {
  // Pair-keyed: `${rocketStem}::${plaidStem}` strings. Pair-only suppression
  // so a "Verizon × pet insurance" reject doesn't also ban real Verizon vs
  // real Verizon, or real pet insurance vs real pet insurance.
  rejectedPairs?: Set<string>;
  resolvedPlaidPatterns?: Set<string>;
  resolvedRocketPatterns?: Set<string>;
}

export function rejectPairKey(rocketStem: string, plaidStem: string): string {
  return `${rocketStem}::${plaidStem}`;
}

/**
 * Propose cross-source merchant matches. The Rocket side is the existing
 * `transactions` table; the Plaid side is `plaid_staging` rows with
 * mode='reference'.
 *
 * Returns one candidate per (Rocket cluster × Plaid cluster) pair scoring above
 * the medium threshold, ranked high→low.
 */
export function proposeCrossSourceMatches(
  rocketTxns: Transaction[],
  plaidReference: PlaidStagingRow[],
  options: ProposeOptions = {},
): ReconcileCandidate[] {
  const rocketRows = rocketTxns.filter((t) => {
    if ((t.source ?? "csv") === "plaid") return false;
    // Excluded/oneTime rows are internal transfers, CC payments, or rare
    // anomalies — not real merchants worth reconciling. Skip them so the
    // wizard isn't littered with single-row "Citi Autopay"-style candidates.
    const o = t.userOverrides ?? {};
    if (o.excluded) return false;
    if (o.oneTime) return false;
    return true;
  });
  const rocketClusters = clusterBy(rocketRows, (t) => normalizeMerchantStem(rocketMerchantKey(t)));
  const plaidClusters = clusterBy(plaidReference, (r) => normalizeMerchantStem(plaidMerchantKey(r)));

  const rejectedPairs = options.rejectedPairs ?? new Set<string>();
  const resolvedRocket = options.resolvedRocketPatterns ?? new Set<string>();
  const resolvedPlaid = options.resolvedPlaidPatterns ?? new Set<string>();

  const candidates: ReconcileCandidate[] = [];

  for (const [plaidStem, plaidCluster] of plaidClusters) {
    // Skip when EVERY raw pattern in this cluster is already resolved by an alias.
    const plaidPatterns = Array.from(new Set(plaidCluster.rows.map((r) => r.name.trim()))).filter(Boolean);
    if (plaidPatterns.length > 0 && plaidPatterns.every((p) => resolvedPlaid.has(p))) continue;

    const plaidAmounts = plaidCluster.rows.map((r) => Math.abs(r.amount));
    const plaidMedian = median(plaidAmounts);
    const plaidSpan = dateSpan(plaidCluster.rows.map((r) => r.date));
    const plaidCategoryMode = mode(plaidCluster.rows.map((r) => r.category).filter(Boolean));
    const plaidAccountIds = new Set(plaidCluster.rows.map((r) => r.accountId).filter(Boolean));

    for (const [rocketStem, rocketCluster] of rocketClusters) {
      if (rejectedPairs.has(rejectPairKey(rocketStem, plaidStem))) continue;

      // Fast pre-filter: if stems share no ≥3-char tokens AND aren't identical,
      // there's no realistic path to MEDIUM_THRESHOLD (max remaining score is
      // 2+2+2+1 = 7, but we'd also need date overlap + account overlap + amount
      // alignment, which is rare for unrelated merchants). Skips most pairs
      // outright in the O(R × P) loop.
      const sharedTokens = shareTokens(rocketStem, plaidStem);
      if (rocketStem !== plaidStem && sharedTokens === 0) continue;

      const rocketPatterns = Array.from(
        new Set(rocketCluster.rows.map((t) => rocketMerchantKey(t))),
      ).filter(Boolean);
      if (rocketPatterns.length > 0 && rocketPatterns.every((p) => resolvedRocket.has(p))) continue;

      let score = 0;
      const signals: string[] = [];

      // 1. Stem token overlap
      if (rocketStem === plaidStem) {
        score += 4;
        signals.push("normalized stems identical");
      } else if (sharedTokens >= 2) {
        score += 3;
        signals.push(`stems share ${sharedTokens} tokens`);
      } else if (sharedTokens === 1) {
        score += 1;
        signals.push("stems share 1 token");
      }

      // 2. Amount medians
      const rocketAmounts = rocketCluster.rows.map((t) => Math.abs(t.amount));
      const rocketMedian = median(rocketAmounts);
      if (plaidMedian > 0 && rocketMedian > 0) {
        const ratio = Math.min(rocketMedian, plaidMedian) / Math.max(rocketMedian, plaidMedian);
        if (ratio >= 0.8) {
          score += 2;
          signals.push(`amount medians close ($${rocketMedian.toFixed(2)}/$${plaidMedian.toFixed(2)})`);
        } else if (ratio >= 0.5) {
          score += 1;
          signals.push(`amount medians within 2x ($${rocketMedian.toFixed(2)}/$${plaidMedian.toFixed(2)})`);
        }
      }

      // 3. Date overlap (date ranges intersect → likely the same active merchant)
      const rocketSpan = dateSpan(rocketCluster.rows.map((t) => t.date));
      if (rocketSpan && plaidSpan && rangesOverlap(rocketSpan, plaidSpan)) {
        score += 2;
        signals.push("date ranges overlap");
      }

      // 4. Account overlap
      const rocketAccountIds = new Set(rocketCluster.rows.map((t) => t.accountId).filter(Boolean));
      const overlap = [...rocketAccountIds].filter((a) => plaidAccountIds.has(a));
      if (overlap.length > 0) {
        score += 2;
        signals.push(`shared on ${overlap.length} account${overlap.length === 1 ? "" : "s"}`);
      }

      // 5. Category match
      const rocketCategoryMode = mode(
        rocketCluster.rows
          .map((t) => t.userOverrides?.category ?? t.category)
          .filter((c): c is string => !!c && c.length > 0),
      );
      if (
        rocketCategoryMode &&
        plaidCategoryMode &&
        rocketCategoryMode.toLowerCase() === plaidCategoryMode.toLowerCase()
      ) {
        score += 1;
        signals.push(`both lean "${rocketCategoryMode}"`);
      }

      if (score < MEDIUM_THRESHOLD) continue;

      const confidence: MerchantAliasConfidence = score >= HIGH_THRESHOLD ? "high" : "medium";
      const proposedCanonicalName = chooseCanonicalName(rocketCluster.rows, plaidCluster.rows);
      const proposedDefaultCategory = chooseDefaultCategory(rocketCluster.rows, plaidCluster.rows);

      candidates.push({
        id: `${rocketStem}::${plaidStem}`,
        proposedCanonicalName,
        proposedDefaultCategory,
        confidence,
        score,
        rocketPatterns,
        plaidPatterns,
        rocketPreview: buildPreview(rocketCluster.rows),
        plaidPreview: buildPreviewPlaid(plaidCluster.rows),
        signals,
        rocketTxnCount: rocketCluster.rows.length,
        plaidTxnCount: plaidCluster.rows.length,
      });
    }
  }

  // Sort: confidence DESC → total txn count DESC → score DESC.
  // Confidence first so the user can safely autopilot through HIGH matches
  // before getting into the more-judgment-required MEDIUM ones. Within a
  // tier, count beats score because each Confirm on a big cluster saves
  // dramatically more downstream work than one on a tiny cluster, and the
  // score gap within a tier is just "how many bonus signals fired."
  const confidenceRank: Record<MerchantAliasConfidence, number> = { high: 2, medium: 1, low: 0 };
  candidates.sort((a, b) => {
    const cr = confidenceRank[b.confidence] - confidenceRank[a.confidence];
    if (cr !== 0) return cr;
    const aCount = a.rocketTxnCount + a.plaidTxnCount;
    const bCount = b.rocketTxnCount + b.plaidTxnCount;
    if (bCount !== aCount) return bCount - aCount;
    return b.score - a.score;
  });

  return candidates;
}
