import { effectiveTransactions } from "./aggregations.ts";
import { aggregationDate } from "./period.ts";
import type { Transaction, Rule, Category } from "./types.ts";

export type PacingGranularity = "month" | "quarter" | "year";

export interface PacingBucket {
  /** 1-indexed bucket position on the X axis. */
  index: number;
  /** Short label for the X axis / drill-down heading ("5", "Jun 5", "Wk 23"). */
  label: string;
  /** Label for the previous-period analog (e.g. "Mar 5" when the current is "Jun 5"). */
  previousLabel: string;
  /** Pre-formatted tooltip prefix: "Through June 5" / "Q2 2026 · Through May 22" / "2026 · Through Wk 22". */
  currentTooltipLabel: string;
  previousTooltipLabel: string;
  /** ISO YYYY-MM-DD start of this bucket in the current period (null if past period end). */
  currentFrom: string | null;
  /** ISO end of this bucket in the current period, inclusive. */
  currentTo: string | null;
  /** ISO start of the analogous bucket in the previous period. */
  previousFrom: string | null;
  previousTo: string | null;
  /** Cumulative spend through this bucket, current period. */
  currentExclOneTime: number | null;
  currentInclOneTime: number | null;
  /** Cumulative spend through this bucket, previous period. */
  previousExclOneTime: number | null;
  previousInclOneTime: number | null;
}

export interface PacingResult {
  granularity: PacingGranularity;
  buckets: PacingBucket[];
  currentPeriodLabel: string;
  previousPeriodLabel: string;
  currentTotalExclOneTime: number;
  currentTotalInclOneTime: number;
  previousAtSamePointExclOneTime: number;
  previousAtSamePointInclOneTime: number;
  previousFullPeriodExclOneTime: number;
  previousFullPeriodInclOneTime: number;
  /** 1-indexed bucket containing today's date in the current period. */
  currentBucketIndex: number;
  bucketCount: number;
  xAxisTicks: number[];
}

// ── helpers ──────────────────────────────────────────────────────────

const round2 = (n: number) => Math.round(n * 100) / 100;
const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);
const toISO = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const daysBetween = (a: Date, b: Date) =>
  Math.round((b.getTime() - a.getTime()) / 86400000);

function monthShortLabel(y: number, m: number): string {
  return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "short" });
}

function monthLongLabel(y: number, m: number): string {
  return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "long" });
}

function formatDayRange(fromISO: string, toISO: string): string {
  if (fromISO === toISO) {
    const d = new Date(`${fromISO}T00:00:00`);
    return `${monthShortLabel(d.getFullYear(), d.getMonth() + 1)} ${d.getDate()}`;
  }
  const from = new Date(`${fromISO}T00:00:00`);
  const to = new Date(`${toISO}T00:00:00`);
  if (from.getMonth() === to.getMonth() && from.getFullYear() === to.getFullYear()) {
    return `${monthShortLabel(from.getFullYear(), from.getMonth() + 1)} ${from.getDate()}–${to.getDate()}`;
  }
  return `${monthShortLabel(from.getFullYear(), from.getMonth() + 1)} ${from.getDate()} – ${monthShortLabel(to.getFullYear(), to.getMonth() + 1)} ${to.getDate()}`;
}

interface PeriodSpan {
  start: Date;
  end: Date; // inclusive
  label: string;
}

function currentPeriodSpan(anchor: Date, g: PacingGranularity): PeriodSpan {
  const y = anchor.getFullYear();
  const m = anchor.getMonth();
  if (g === "month") {
    const start = new Date(y, m, 1);
    const end = new Date(y, m + 1, 0);
    return { start, end, label: monthShortLabel(y, m + 1) };
  }
  if (g === "quarter") {
    const qStartMonth = Math.floor(m / 3) * 3;
    const start = new Date(y, qStartMonth, 1);
    const end = new Date(y, qStartMonth + 3, 0);
    return { start, end, label: `Q${Math.floor(m / 3) + 1} ${y}` };
  }
  // year
  return { start: new Date(y, 0, 1), end: new Date(y, 11, 31), label: `${y}` };
}

function previousPeriodSpan(anchor: Date, g: PacingGranularity): PeriodSpan {
  const y = anchor.getFullYear();
  const m = anchor.getMonth();
  if (g === "month") {
    const py = m === 0 ? y - 1 : y;
    const pm = m === 0 ? 11 : m - 1;
    const start = new Date(py, pm, 1);
    const end = new Date(py, pm + 1, 0);
    return { start, end, label: monthShortLabel(py, pm + 1) };
  }
  if (g === "quarter") {
    const qStartMonth = Math.floor(m / 3) * 3;
    const prevQStart = qStartMonth === 0
      ? new Date(y - 1, 9, 1)
      : new Date(y, qStartMonth - 3, 1);
    const prevQEnd = new Date(prevQStart.getFullYear(), prevQStart.getMonth() + 3, 0);
    const qNum = Math.floor(prevQStart.getMonth() / 3) + 1;
    return {
      start: prevQStart,
      end: prevQEnd,
      label: `Q${qNum} ${prevQStart.getFullYear()}`,
    };
  }
  return { start: new Date(y - 1, 0, 1), end: new Date(y - 1, 11, 31), label: `${y - 1}` };
}

function dayCount(span: PeriodSpan): number {
  return daysBetween(span.start, span.end) + 1;
}

/**
 * Build bucket descriptors for a (current, previous) span pair at the chosen
 * granularity. Each bucket is one calendar day for month/quarter, one 7-day
 * window for year (week 1 = Jan 1–7).
 *
 * Buckets are 1-indexed because the X-axis in PacingClient renders the
 * `index` value as the day-of-period (matches the original month behavior).
 */
type BucketSpec = Omit<PacingBucket, "currentExclOneTime" | "currentInclOneTime" | "previousExclOneTime" | "previousInclOneTime">;

function buildBuckets(
  cur: PeriodSpan,
  prev: PeriodSpan,
  g: PacingGranularity,
): {
  buckets: BucketSpec[];
  bucketSizeDays: number;
} {
  const bucketSizeDays = g === "year" ? 7 : 1;
  const curBuckets = Math.ceil(dayCount(cur) / bucketSizeDays);
  const prevBuckets = Math.ceil(dayCount(prev) / bucketSizeDays);
  const total = Math.max(curBuckets, prevBuckets);

  const out: BucketSpec[] = [];
  for (let i = 0; i < total; i++) {
    const curStart = addDays(cur.start, i * bucketSizeDays);
    const curEnd = bucketSizeDays === 1 ? curStart : addDays(curStart, bucketSizeDays - 1);
    const curEndClipped = curEnd > cur.end ? cur.end : curEnd;
    const inCur = i < curBuckets;

    // Quarter aligns the previous bucket to (month-in-quarter, day-in-month).
    let prevStart: Date | null;
    let prevEnd: Date | null;
    if (g === "quarter" && inCur) {
      const monthInQ = (curStart.getMonth() - cur.start.getMonth() + 12) % 12;
      const dayOfMonth = curStart.getDate();
      const prevMonthAbs = prev.start.getMonth() + monthInQ;
      const prevYearAdj = prev.start.getFullYear() + Math.floor(prevMonthAbs / 12);
      const prevMonth = ((prevMonthAbs % 12) + 12) % 12;
      const daysInPrevMonth = new Date(prevYearAdj, prevMonth + 1, 0).getDate();
      if (dayOfMonth <= daysInPrevMonth) {
        prevStart = new Date(prevYearAdj, prevMonth, dayOfMonth);
        prevEnd = prevStart;
      } else {
        prevStart = null;
        prevEnd = null;
      }
    } else {
      const ps = addDays(prev.start, i * bucketSizeDays);
      const pe = bucketSizeDays === 1 ? ps : addDays(ps, bucketSizeDays - 1);
      const inPrev = i < prevBuckets;
      prevStart = inPrev ? ps : null;
      prevEnd = inPrev ? (pe > prev.end ? prev.end : pe) : null;
    }

    let label: string;
    let previousLabel: string;
    if (g === "month") {
      label = `${i + 1}`;
      previousLabel = label;
    } else if (g === "quarter") {
      const d = inCur ? curStart : prevStart;
      label = d ? `${monthShortLabel(d.getFullYear(), d.getMonth() + 1)} ${d.getDate()}` : "—";
      previousLabel = prevStart
        ? `${monthShortLabel(prevStart.getFullYear(), prevStart.getMonth() + 1)} ${prevStart.getDate()}`
        : "—";
    } else {
      label = `Wk ${i + 1}`;
      previousLabel = label;
    }

    out.push({
      index: i + 1,
      label,
      previousLabel,
      // tooltip labels are filled in after the orphan-wrap post-process so the
      // wrapped previousTo is reflected in the prefix.
      currentTooltipLabel: "",
      previousTooltipLabel: "",
      currentFrom: inCur ? toISO(curStart) : null,
      currentTo: inCur ? toISO(curEndClipped) : null,
      previousFrom: prevStart ? toISO(prevStart) : null,
      previousTo: prevEnd ? toISO(prevEnd) : null,
    });
  }

  // Quarter orphan-day wrap: any prev-quarter day with no analog in current
  // quarter (e.g. Jan 31 when mapping Q1→Q2, since Apr has only 30 days) gets
  // folded into the latest preceding bucket of the same month. Clicking
  // "Apr 30 / Jan 30" then surfaces both Jan 30 and Jan 31 transactions.
  if (g === "quarter") {
    const mapped = new Set<string>();
    for (const b of out) {
      if (!b.previousFrom || !b.previousTo) continue;
      for (let d = new Date(`${b.previousFrom}T00:00:00`); d <= new Date(`${b.previousTo}T00:00:00`); d = addDays(d, 1)) {
        mapped.add(toISO(d));
      }
    }
    for (let d = new Date(prev.start); d <= prev.end; d = addDays(d, 1)) {
      const iso = toISO(d);
      if (mapped.has(iso)) continue;
      // Find latest bucket with previousTo in same month and earlier than this day.
      let best = -1;
      let bestTo = "";
      const ym = iso.slice(0, 7);
      for (let i = 0; i < out.length; i++) {
        const pTo = out[i].previousTo;
        if (!pTo) continue;
        if (pTo.slice(0, 7) === ym && pTo < iso && pTo > bestTo) {
          bestTo = pTo;
          best = i;
        }
      }
      if (best >= 0) {
        out[best].previousTo = iso;
        mapped.add(iso);
      }
    }
  }

  // Refresh previousLabel for any quarter bucket whose previousTo now spans
  // multiple days (orphan-wrap case) so the drill-down heading reads
  // "Jan 30–31" instead of "Jan 30".
  if (g === "quarter") {
    for (const b of out) {
      if (b.previousFrom && b.previousTo && b.previousFrom !== b.previousTo) {
        b.previousLabel = formatDayRange(b.previousFrom, b.previousTo);
      }
    }
  }

  // Now build tooltip labels (after any quarter orphan-wrap so wrapped
  // ranges render as "Jan 30–31").
  for (const b of out) {
    b.currentTooltipLabel = buildTooltipLabel(g, cur, b.currentFrom, b.currentTo, b.label);
    b.previousTooltipLabel = buildTooltipLabel(g, prev, b.previousFrom, b.previousTo, b.previousLabel);
  }

  return { buckets: out, bucketSizeDays };
}

function buildTooltipLabel(
  g: PacingGranularity,
  span: PeriodSpan,
  fromISO: string | null,
  toISO: string | null,
  fallbackLabel: string,
): string {
  if (!fromISO || !toISO) return "—";
  if (g === "month") {
    const d = new Date(`${fromISO}T00:00:00`);
    return `Through ${monthLongLabel(d.getFullYear(), d.getMonth() + 1)} ${d.getDate()}`;
  }
  if (g === "quarter") {
    return `${span.label} · Through ${formatDayRange(fromISO, toISO)}`;
  }
  // year: "2026 · Through Wk 22"
  return `${span.label} · Through ${fallbackLabel}`;
}

function xAxisTicksFor(g: PacingGranularity, bucketCount: number): number[] {
  if (g === "month") return [1, 7, 14, 21, 28].filter((t) => t <= bucketCount);
  if (g === "quarter") {
    // Roughly month boundaries inside the quarter (day 1, ~31, ~61).
    return [1, 31, 61].filter((t) => t <= bucketCount);
  }
  // year: every 13 weeks ≈ quarter boundary
  return [1, 13, 26, 39, 52].filter((t) => t <= bucketCount);
}

// ── public API ──────────────────────────────────────────────────────

/**
 * Day-by-day (or week-by-week for year) cumulative spend for the anchor period
 * and the prior period. "Spend" follows the dashboard convention: rules
 * applied, excluded rows dropped, income-classified rows dropped, positive
 * amounts dropped (unless this row is a netted refund — those subtract).
 *
 * `null` past the live bucket lets recharts break the line cleanly.
 */
export function computePacing(
  transactions: Transaction[],
  rules: Rule[],
  categoryMap: Map<string, Category>,
  accountTagMap: Map<string, string[]>,
  granularity: PacingGranularity,
  anchor: Date = new Date(),
  nettedRefundIds: Set<string> = new Set(),
): PacingResult {
  const cur = currentPeriodSpan(anchor, granularity);
  const prev = previousPeriodSpan(anchor, granularity);
  const { buckets: bucketSpecs, bucketSizeDays } = buildBuckets(cur, prev, granularity);
  const bucketCount = bucketSpecs.length;

  // Per-bucket per-axis raw spend (not cumulative yet).
  const curExcl = new Array<number>(bucketCount).fill(0);
  const curIncl = new Array<number>(bucketCount).fill(0);
  const prevExcl = new Array<number>(bucketCount).fill(0);
  const prevIncl = new Array<number>(bucketCount).fill(0);

  const curStartMs = cur.start.getTime();

  // Reverse map prevISO → bucketIdx, derived from bucket specs. For month/year
  // this is identical to straight day-offset arithmetic, but for quarter it
  // honors the (month-in-quarter, day-in-month) alignment so a prev-period
  // transaction lands in the bucket whose previousFrom matches its date.
  // Buckets with no previousFrom (e.g. Q2's May 31 → Feb 31 N/A) drop those
  // prev-quarter days from the cumulative — they have no on-screen position.
  const prevDateToBucket = new Map<string, number>();
  for (let i = 0; i < bucketCount; i++) {
    const spec = bucketSpecs[i];
    if (!spec.previousFrom || !spec.previousTo) continue;
    const start = new Date(`${spec.previousFrom}T00:00:00`);
    const end = new Date(`${spec.previousTo}T00:00:00`);
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
      prevDateToBucket.set(toISO(d), i);
    }
  }

  const effective = effectiveTransactions(transactions, rules, categoryMap, accountTagMap, {
    excludeOneTime: false,
  });

  for (const tx of effective) {
    const aggISO = aggregationDate(tx);
    const txDate = new Date(`${aggISO}T00:00:00`);
    const inCur = txDate >= cur.start && txDate <= cur.end;
    const inPrev = txDate >= prev.start && txDate <= prev.end;
    if (!inCur && !inPrev) continue;

    const classification = categoryMap.get(tx.category || "Uncategorized")?.classification;
    if (classification === "income") continue;
    if (tx.amount > 0 && !nettedRefundIds.has(tx.id)) continue;

    const spend = -tx.amount;
    const isOneTime = tx.userOverrides?.oneTime === true;

    if (inCur) {
      const bucketIdx = Math.floor((txDate.getTime() - curStartMs) / 86400000 / bucketSizeDays);
      if (bucketIdx >= 0 && bucketIdx < bucketCount) {
        curIncl[bucketIdx] += spend;
        if (!isOneTime) curExcl[bucketIdx] += spend;
      }
    } else {
      const bucketIdx = prevDateToBucket.get(aggISO);
      if (bucketIdx == null) {
        // Quarter day with no analog in current quarter (e.g. Jan 31 when
        // mapping Q1→Q2). Falls out of the cumulative on purpose so the prev
        // curve plateaus rather than over-reporting.
        continue;
      }
      prevIncl[bucketIdx] += spend;
      if (!isOneTime) prevExcl[bucketIdx] += spend;
    }
  }

  // Bucket containing today's date (1-indexed), or last bucket of the period
  // if the period is past, or 0 if not started.
  const todayMs = new Date(toISO(anchor) + "T00:00:00").getTime();
  let currentBucketIndex: number;
  if (todayMs < curStartMs) {
    currentBucketIndex = 0;
  } else if (todayMs > cur.end.getTime()) {
    // Period is fully in the past — show all bucket as "live".
    currentBucketIndex = Math.ceil(dayCount(cur) / bucketSizeDays);
  } else {
    currentBucketIndex =
      Math.floor((todayMs - curStartMs) / 86400000 / bucketSizeDays) + 1;
  }

  const buckets: PacingBucket[] = [];
  let curRunExcl = 0;
  let curRunIncl = 0;
  let prevRunExcl = 0;
  let prevRunIncl = 0;

  for (let i = 0; i < bucketCount; i++) {
    curRunExcl += curExcl[i];
    curRunIncl += curIncl[i];
    prevRunExcl += prevExcl[i];
    prevRunIncl += prevIncl[i];

    const spec = bucketSpecs[i];
    const curLive = spec.currentFrom != null && i + 1 <= currentBucketIndex;
    const prevLive = spec.previousFrom != null;

    buckets.push({
      ...spec,
      currentExclOneTime: curLive ? round2(curRunExcl) : null,
      currentInclOneTime: curLive ? round2(curRunIncl) : null,
      previousExclOneTime: prevLive ? round2(prevRunExcl) : null,
      previousInclOneTime: prevLive ? round2(prevRunIncl) : null,
    });
  }

  // "Same point" comparison: prev cumulative through the same bucket index.
  const compareIdx = Math.min(currentBucketIndex, bucketCount);
  let prevAtCompareExcl = 0;
  let prevAtCompareIncl = 0;
  for (let i = 0; i < compareIdx; i++) {
    prevAtCompareExcl += prevExcl[i];
    prevAtCompareIncl += prevIncl[i];
  }

  return {
    granularity,
    buckets,
    currentPeriodLabel: cur.label,
    previousPeriodLabel: prev.label,
    currentTotalExclOneTime: round2(curRunExcl),
    currentTotalInclOneTime: round2(curRunIncl),
    previousAtSamePointExclOneTime: round2(prevAtCompareExcl),
    previousAtSamePointInclOneTime: round2(prevAtCompareIncl),
    previousFullPeriodExclOneTime: round2(prevRunExcl),
    previousFullPeriodInclOneTime: round2(prevRunIncl),
    currentBucketIndex,
    bucketCount,
    xAxisTicks: xAxisTicksFor(granularity, bucketCount),
  };
}

