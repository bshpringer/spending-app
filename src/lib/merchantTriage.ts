import type { Transaction } from "./types.ts";
import { normalizeMerchantStem } from "./merchantReconcile.ts";

// Cap on preview rows serialized per cluster — the triage page renders the
// whole cluster list at once, so unbounded previews would ship megabytes for
// paycheck-style clusters.
const PREVIEW_LIMIT = 30;

export interface TriagePreviewRow {
  date: string;
  rawName: string;
  amount: number;
  category: string;
  source: string;
}

export interface TriageCluster {
  stem: string;
  /** Most common raw merchant key — the human-readable face of the cluster. */
  label: string;
  proposedCanonicalName: string;
  proposedCategory: string | null;
  txnCount: number;
  variantCount: number;
  totalAbsAmount: number;
  firstDate: string;
  lastDate: string;
  /** Raw merchant keys from csv/manual rows → alias source 'rocket'. */
  rocketPatterns: string[];
  /** Raw merchant keys from plaid rows → alias source 'plaid'. */
  plaidPatterns: string[];
  /** Sample rows (newest first), capped at PREVIEW_LIMIT. */
  preview: TriagePreviewRow[];
  dismissed: boolean;
}

function mode(items: string[]): string | null {
  if (items.length === 0) return null;
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i, (counts.get(i) ?? 0) + 1);
  let best: string | null = null;
  let bestCount = -1;
  for (const [k, c] of counts) {
    if (c > bestCount) {
      best = k;
      bestCount = c;
    }
  }
  return best;
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Propose a canonical name for a cluster. If every row shares one raw name and
 * it's already mixed-case (i.e. a human or Plaid cleaned it), keep it verbatim.
 * Otherwise fall back to the title-cased stem — raw bank strings are SHOUTY
 * and full of store numbers, and the stem already has that noise stripped.
 */
export function proposeCanonicalName(stem: string, rawNames: string[]): string {
  const unique = Array.from(new Set(rawNames.map((n) => n.trim()).filter(Boolean)));
  if (unique.length === 1 && unique[0] !== unique[0].toUpperCase()) return unique[0];
  return titleCase(stem);
}

/**
 * Group unreconciled transactions (no canonicalName, not excluded/oneTime)
 * into per-merchant-stem clusters for the triage page. Sorted by txn count
 * DESC then total |amount| DESC, so the biggest wins surface first.
 */
export function buildTriageClusters(
  txns: Transaction[],
  dismissedStems: Set<string>,
): TriageCluster[] {
  interface Acc {
    stem: string;
    rows: Transaction[];
    keys: Map<string, string>; // raw merchant key → source kind ('rocket' | 'plaid')
  }
  const acc = new Map<string, Acc>();

  for (const t of txns) {
    if (t.canonicalName && t.canonicalName.trim() !== "") continue;
    const o = t.userOverrides ?? {};
    if (o.excluded || o.oneTime) continue;
    const key = (t.customName ?? t.name).trim();
    const stem = normalizeMerchantStem(key);
    if (!stem) continue;
    let bucket = acc.get(stem);
    if (!bucket) {
      bucket = { stem, rows: [], keys: new Map() };
      acc.set(stem, bucket);
    }
    bucket.rows.push(t);
    // The same raw key can appear from both sources; 'both' registers it
    // under both alias source kinds on confirm.
    const sourceKind = t.source === "plaid" ? "plaid" : "rocket";
    const prev = bucket.keys.get(key);
    if (!prev) bucket.keys.set(key, sourceKind);
    else if (prev !== sourceKind) bucket.keys.set(key, "both");
  }

  const clusters: TriageCluster[] = [];
  for (const { stem, rows, keys } of acc.values()) {
    const rawNames = rows.map((t) => (t.customName ?? t.name).trim());
    const label = mode(rawNames) ?? stem;
    const cats = rows
      .map((t) => t.userOverrides?.category ?? t.category)
      .filter((c): c is string => !!c && c.length > 0 && c.toLowerCase() !== "uncategorized");
    const dates = rows.map((t) => t.date).sort();
    const sortedRows = [...rows].sort((a, b) => (a.date < b.date ? 1 : -1));
    const rocketPatterns: string[] = [];
    const plaidPatterns: string[] = [];
    for (const [key, kind] of keys) {
      if (kind === "rocket" || kind === "both") rocketPatterns.push(key);
      if (kind === "plaid" || kind === "both") plaidPatterns.push(key);
    }
    clusters.push({
      stem,
      label,
      proposedCanonicalName: proposeCanonicalName(stem, rawNames),
      proposedCategory: mode(cats),
      txnCount: rows.length,
      variantCount: new Set(rawNames).size,
      totalAbsAmount: rows.reduce((sum, t) => sum + Math.abs(t.amount), 0),
      firstDate: dates[0],
      lastDate: dates[dates.length - 1],
      rocketPatterns,
      plaidPatterns,
      preview: sortedRows.slice(0, PREVIEW_LIMIT).map((t) => ({
        date: t.date,
        rawName: (t.customName ?? t.name).trim(),
        amount: t.amount,
        category: t.userOverrides?.category ?? t.category,
        source: t.source,
      })),
      dismissed: dismissedStems.has(stem),
    });
  }

  clusters.sort((a, b) => {
    if (b.txnCount !== a.txnCount) return b.txnCount - a.txnCount;
    return b.totalAbsAmount - a.totalAbsAmount;
  });
  return clusters;
}
