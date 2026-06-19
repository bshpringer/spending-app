/**
 * Period primitives for the Trends time-range filter.
 *
 * Granularity = "week" | "month" | "quarter" | "year"
 *
 * Period keys are formatted as:
 *   - week:    "YYYY-Www"   (ISO week, Mon–Sun)
 *   - month:   "YYYY-MM"
 *   - quarter: "YYYY-Qn"
 *   - year:    "YYYY"
 */

export type Granularity = "week" | "month" | "quarter" | "year";

// ── helpers ──────────────────────────────────────────────────────────

/** ISO week number (Mon=1, Sun=7). Returns [isoYear, isoWeek]. */
function isoWeekOf(d: Date): [number, number] {
  // Copy to avoid mutation
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  // Set to nearest Thursday (ISO weeks start Monday)
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return [t.getUTCFullYear(), week];
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function parseISODate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Quarter number (1-4) for a 0-based month. */
function quarterOf(month0: number): number {
  return Math.floor(month0 / 3) + 1;
}

// ── public API ───────────────────────────────────────────────────────

/**
 * The date a transaction should aggregate to in charts and totals.
 *
 * Two date fields exist on every transaction: `originalDate` (the swipe /
 * authorized date — when the user actually spent money) and `date` (Plaid's
 * posted / settle date, or the CSV "Date" column). For Plaid pending→posted
 * transitions and any merchant that settles a few days after authorization,
 * these diverge by up to a week. The display layer already falls back to
 * `originalDate ?? date`; aggregations match that so a charge swiped on June 1
 * never shifts to June 3 just because the bank posted it later.
 *
 * Mirror in SQL with: `COALESCE(NULLIF(originalDate, ''), date)`.
 */
export function aggregationDate(tx: { date: string; originalDate?: string | null }): string {
  return tx.originalDate || tx.date;
}

/** SQL expression equivalent of `aggregationDate()`. Inline into queries. */
export const AGG_DATE_SQL = "COALESCE(NULLIF(t.originalDate, ''), t.date)";

/**
 * Compute the period key for a given ISO date string and granularity.
 *
 * Examples:
 *   periodKeyFor("2026-06-04", "month")   → "2026-06"
 *   periodKeyFor("2026-06-04", "quarter") → "2026-Q2"
 *   periodKeyFor("2026-06-04", "year")    → "2026"
 *   periodKeyFor("2026-06-04", "week")    → "2026-W23"
 */
export function periodKeyFor(dateISO: string, g: Granularity): string {
  switch (g) {
    case "month":
      return dateISO.slice(0, 7);
    case "quarter": {
      const d = parseISODate(dateISO);
      return `${d.getFullYear()}-Q${quarterOf(d.getMonth())}`;
    }
    case "year":
      return dateISO.slice(0, 4);
    case "week": {
      const d = parseISODate(dateISO);
      const [iy, iw] = isoWeekOf(d);
      return `${iy}-W${pad2(iw)}`;
    }
  }
}

/**
 * Return the previous period's key (same granularity).
 *
 * Examples:
 *   prevPeriod("2026-06", "month")  → "2026-05"
 *   prevPeriod("2026-01", "month")  → "2025-12"
 *   prevPeriod("2026-Q1", "quarter") → "2025-Q4"
 *   prevPeriod("2026", "year")      → "2025"
 *   prevPeriod("2026-W01", "week")  → "2025-W52" (or W53 depending on year)
 */
export function prevPeriod(key: string, g: Granularity): string {
  switch (g) {
    case "month": {
      const [y, m] = key.split("-").map(Number);
      const d = new Date(y, m - 2, 1);
      return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
    }
    case "quarter": {
      const y = parseInt(key.slice(0, 4), 10);
      const q = parseInt(key.slice(6), 10);
      if (q === 1) return `${y - 1}-Q4`;
      return `${y}-Q${q - 1}`;
    }
    case "year": {
      return `${parseInt(key, 10) - 1}`;
    }
    case "week": {
      // Parse YYYY-Www, subtract 7 days from the Monday of that week, recompute
      const start = periodStartDate(key, g);
      const prev = new Date(start.getFullYear(), start.getMonth(), start.getDate() - 7);
      const [iy, iw] = isoWeekOf(prev);
      return `${iy}-W${pad2(iw)}`;
    }
  }
}

/**
 * Human-readable label for a period key.
 *
 * Examples:
 *   formatPeriodLabel("2026-06", "month")     → "Jun 2026"
 *   formatPeriodLabel("2026-Q2", "quarter")   → "Q2 2026"
 *   formatPeriodLabel("2026", "year")         → "2026"
 *   formatPeriodLabel("2026-W23", "week")     → "Jun 1–7, 2026"
 */
export function formatPeriodLabel(key: string, g: Granularity): string {
  switch (g) {
    case "month": {
      const [y, m] = key.split("-").map(Number);
      const d = new Date(y, m - 1, 1);
      return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
    }
    case "quarter": {
      const y = key.slice(0, 4);
      const q = key.slice(5); // "Q2"
      return `${q} ${y}`;
    }
    case "year":
      return key;
    case "week": {
      const start = periodStartDate(key, g);
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
      const mStart = start.toLocaleDateString("en-US", { month: "short" });
      const mEnd = end.toLocaleDateString("en-US", { month: "short" });
      if (mStart === mEnd) {
        return `${mStart} ${start.getDate()}–${end.getDate()}, ${start.getFullYear()}`;
      }
      return `${mStart} ${start.getDate()} – ${mEnd} ${end.getDate()}, ${end.getFullYear()}`;
    }
  }
}

/**
 * Compare two period keys of the same granularity for sorting.
 * Returns negative if a < b, positive if a > b, 0 if equal.
 * String comparison works for all our key formats.
 */
export function comparePeriodKeys(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Does the period contain the given ISO date?
 */
export function periodContainsDate(key: string, g: Granularity, dateISO: string): boolean {
  return periodKeyFor(dateISO, g) === key;
}

/**
 * What fraction of the period has elapsed as of `asOf`?
 * Returns 0..1. If the period hasn't started, returns 0; if it's past, returns 1.
 */
export function elapsedFractionOfPeriod(key: string, g: Granularity, asOf: Date): number {
  const start = periodStartDate(key, g);
  const end = periodEndDate(key, g);
  const startMs = start.getTime();
  const endMs = end.getTime() + 86400000; // end is inclusive, so add 1 day
  const nowMs = asOf.getTime();
  if (nowMs <= startMs) return 0;
  if (nowMs >= endMs) return 1;
  return (nowMs - startMs) / (endMs - startMs);
}

/**
 * Compute the clip date for apples-to-apples comparison.
 * Given the current period key and a comparison period key, returns the
 * date in the comparison period that corresponds to `asOf`'s relative
 * position in the current period.
 *
 * For example, if we're on June 4 (day 4 of June) and comparing to May,
 * the clip date is May 4.
 */
export function comparisonClipDate(
  currentKey: string,
  comparisonKey: string,
  g: Granularity,
  asOf: Date,
): string {
  const curStart = periodStartDate(currentKey, g);
  const curEnd = periodEndDate(currentKey, g);
  const curEndMs = curEnd.getTime() + 86400000;
  const curStartMs = curStart.getTime();
  const totalMs = curEndMs - curStartMs;
  const elapsedMs = Math.min(Math.max(asOf.getTime() - curStartMs, 0), totalMs);
  const fraction = totalMs > 0 ? elapsedMs / totalMs : 1;

  const compStart = periodStartDate(comparisonKey, g);
  const compEnd = periodEndDate(comparisonKey, g);
  const compEndMs = compEnd.getTime() + 86400000;
  const compStartMs = compStart.getTime();
  const compTotalMs = compEndMs - compStartMs;

  const clipMs = compStartMs + fraction * compTotalMs;
  const clipDate = new Date(clipMs);
  return `${clipDate.getFullYear()}-${pad2(clipDate.getMonth() + 1)}-${pad2(clipDate.getDate())}`;
}

/**
 * The first day of the period (inclusive).
 */
export function periodStartDate(key: string, g: Granularity): Date {
  switch (g) {
    case "month": {
      const [y, m] = key.split("-").map(Number);
      return new Date(y, m - 1, 1);
    }
    case "quarter": {
      const y = parseInt(key.slice(0, 4), 10);
      const q = parseInt(key.slice(6), 10);
      return new Date(y, (q - 1) * 3, 1);
    }
    case "year":
      return new Date(parseInt(key, 10), 0, 1);
    case "week": {
      // Parse YYYY-Www and find the Monday of that ISO week
      const y = parseInt(key.slice(0, 4), 10);
      const w = parseInt(key.slice(6), 10);
      // Jan 4 is always in week 1 of its ISO year
      const jan4 = new Date(y, 0, 4);
      const dow = jan4.getDay() || 7; // 1=Mon..7=Sun
      // Monday of week 1
      const mon1 = new Date(y, 0, 4 - dow + 1);
      // Monday of target week
      return new Date(mon1.getFullYear(), mon1.getMonth(), mon1.getDate() + (w - 1) * 7);
    }
  }
}

/**
 * The last day of the period (inclusive).
 */
export function periodEndDate(key: string, g: Granularity): Date {
  switch (g) {
    case "month": {
      const [y, m] = key.split("-").map(Number);
      return new Date(y, m, 0); // day 0 of next month = last day of this month
    }
    case "quarter": {
      const y = parseInt(key.slice(0, 4), 10);
      const q = parseInt(key.slice(6), 10);
      return new Date(y, q * 3, 0);
    }
    case "year":
      return new Date(parseInt(key, 10), 11, 31);
    case "week": {
      const start = periodStartDate(key, g);
      return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
    }
  }
}

/**
 * Returns the total number of days in the period.
 */
export function periodLengthDays(key: string, g: Granularity): number {
  const start = periodStartDate(key, g);
  const end = periodEndDate(key, g);
  return Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
}

/**
 * Returns whether the period is "in progress" (contains today).
 */
export function periodIsInProgress(key: string, g: Granularity): boolean {
  const today = new Date();
  const todayISO = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;
  return periodContainsDate(key, g, todayISO);
}

/**
 * Short label for the period selector bar (compact).
 *   month:   "Jun"
 *   quarter: "Q2"
 *   year:    "2026"
 *   week:    "Jun 1"
 */
export function formatPeriodShort(key: string, g: Granularity): string {
  switch (g) {
    case "month": {
      const [y, m] = key.split("-").map(Number);
      return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "short" });
    }
    case "quarter":
      return key.slice(5); // "Q2"
    case "year":
      return key;
    case "week": {
      const start = periodStartDate(key, g);
      return start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }
  }
}

/**
 * Year label for the period (used above period buttons for year-change markers).
 */
export function formatPeriodYear(key: string, g: Granularity): string {
  switch (g) {
    case "month":
    case "quarter":
    case "week":
      return key.slice(0, 4);
    case "year":
      return key;
  }
}
