import {
  periodKeyFor,
  periodStartDate,
  periodEndDate,
  comparePeriodKeys,
  type Granularity,
} from "./period.ts";

// Bar-chart bucketing for the category + merchant detail pages. Reuses the
// /trends period math (periodKeyFor / periodStartDate / periodEndDate) but only
// the month/quarter/year subset — no week, no period selector. Labels carry
// their own year context (unlike formatPeriodShort, which drops it for the
// period-selector layout).

export type DetailGranularity = "month" | "quarter" | "year";

export const DETAIL_GRANULARITIES: { key: DetailGranularity; label: string }[] = [
  { key: "month", label: "Month" },
  { key: "quarter", label: "Quarter" },
  { key: "year", label: "Year" },
];

export interface DetailBucket {
  key: string; // period key, e.g. "2024-06" | "2024-Q2" | "2024"
  label: string; // pre-formatted x-axis label, e.g. "Jun 24" | "Q2 '24" | "2024"
  amount: number;
}

export function parseDetailGranularity(v: string | undefined): DetailGranularity {
  return v === "quarter" || v === "year" ? v : "month";
}

function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function formatBucketLabel(key: string, g: DetailGranularity): string {
  switch (g) {
    case "month": {
      const [y, m] = key.split("-").map(Number);
      return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
    }
    case "quarter":
      return `${key.slice(5)} '${key.slice(2, 4)}`; // "Q2 '24"
    case "year":
      return key;
  }
}

/** Inclusive [from, to] ISO date strings spanning the bucket — for click-to-filter. */
export function bucketRange(key: string, g: DetailGranularity): { from: string; to: string } {
  return {
    from: ymdLocal(periodStartDate(key, g as Granularity)),
    to: ymdLocal(periodEndDate(key, g as Granularity)),
  };
}

function advance(d: Date, g: DetailGranularity): void {
  // d is always the first day of its period (from periodStartDate), so these
  // increments never hit month-end rollover surprises.
  if (g === "month") d.setMonth(d.getMonth() + 1);
  else if (g === "quarter") d.setMonth(d.getMonth() + 3);
  else d.setFullYear(d.getFullYear() + 1);
}

/**
 * Sum signed per-transaction values into buckets at the chosen granularity,
 * sorted chronologically. The caller pre-signs each value (e.g. expense pages
 * pass -amount so spend reads positive). Gaps between the first and last
 * populated period are filled with zero-amount buckets so the chart x-axis is
 * continuous (empty months/quarters/years render as 0-height bars).
 */
export function bucketByGranularity(
  entries: { dateISO: string; value: number }[],
  g: DetailGranularity,
): DetailBucket[] {
  const map = new Map<string, number>();
  for (const e of entries) {
    const key = periodKeyFor(e.dateISO, g as Granularity);
    map.set(key, (map.get(key) ?? 0) + e.value);
  }
  if (map.size === 0) return [];

  const keys = [...map.keys()].sort(comparePeriodKeys);
  const lastKey = keys[keys.length - 1];
  const out: DetailBucket[] = [];
  const cursor = periodStartDate(keys[0], g as Granularity);
  for (let guard = 0; guard < 10000; guard++) {
    const key = periodKeyFor(ymdLocal(cursor), g as Granularity);
    const amount = Math.round((map.get(key) ?? 0) * 100) / 100;
    out.push({ key, label: formatBucketLabel(key, g), amount });
    if (comparePeriodKeys(key, lastKey) >= 0) break;
    advance(cursor, g);
  }
  return out;
}
