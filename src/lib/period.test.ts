import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  periodKeyFor,
  prevPeriod,
  formatPeriodLabel,
  comparePeriodKeys,
  periodContainsDate,
  elapsedFractionOfPeriod,
  comparisonClipDate,
  periodStartDate,
  periodEndDate,
  periodLengthDays,
  formatPeriodShort,
  formatPeriodYear,
} from "./period.ts";

// ── periodKeyFor ────────────────────────────────────────────────────

describe("periodKeyFor", () => {
  it("month", () => {
    assert.equal(periodKeyFor("2026-06-04", "month"), "2026-06");
    assert.equal(periodKeyFor("2026-01-01", "month"), "2026-01");
    assert.equal(periodKeyFor("2025-12-31", "month"), "2025-12");
  });

  it("quarter", () => {
    assert.equal(periodKeyFor("2026-01-15", "quarter"), "2026-Q1");
    assert.equal(periodKeyFor("2026-04-01", "quarter"), "2026-Q2");
    assert.equal(periodKeyFor("2026-06-04", "quarter"), "2026-Q2");
    assert.equal(periodKeyFor("2026-07-01", "quarter"), "2026-Q3");
    assert.equal(periodKeyFor("2026-10-01", "quarter"), "2026-Q4");
    assert.equal(periodKeyFor("2026-12-31", "quarter"), "2026-Q4");
  });

  it("year", () => {
    assert.equal(periodKeyFor("2026-06-04", "year"), "2026");
    assert.equal(periodKeyFor("2025-01-01", "year"), "2025");
  });

  it("week (ISO)", () => {
    // 2026-06-01 is a Monday → W23
    assert.equal(periodKeyFor("2026-06-01", "week"), "2026-W23");
    // 2026-06-04 (Thursday) same week
    assert.equal(periodKeyFor("2026-06-04", "week"), "2026-W23");
    // 2026-06-07 (Sunday) still W23
    assert.equal(periodKeyFor("2026-06-07", "week"), "2026-W23");
    // 2026-06-08 (Monday) → W24
    assert.equal(periodKeyFor("2026-06-08", "week"), "2026-W24");
  });

  it("week — year boundary (2025-12-29 is ISO week 1 of 2026)", () => {
    // Dec 29 2025 is a Monday. ISO: since Jan 1 2026 is a Thursday,
    // the week containing it is W01 of 2026.
    assert.equal(periodKeyFor("2025-12-29", "week"), "2026-W01");
    assert.equal(periodKeyFor("2026-01-04", "week"), "2026-W01"); // Sunday of same week
  });
});

// ── prevPeriod ──────────────────────────────────────────────────────

describe("prevPeriod", () => {
  it("month", () => {
    assert.equal(prevPeriod("2026-06", "month"), "2026-05");
    assert.equal(prevPeriod("2026-01", "month"), "2025-12");
  });

  it("quarter", () => {
    assert.equal(prevPeriod("2026-Q2", "quarter"), "2026-Q1");
    assert.equal(prevPeriod("2026-Q1", "quarter"), "2025-Q4");
  });

  it("year", () => {
    assert.equal(prevPeriod("2026", "year"), "2025");
  });

  it("week", () => {
    assert.equal(prevPeriod("2026-W23", "week"), "2026-W22");
    assert.equal(prevPeriod("2026-W01", "week"), "2025-W52");
  });
});

// ── formatPeriodLabel ───────────────────────────────────────────────

describe("formatPeriodLabel", () => {
  it("month", () => {
    assert.equal(formatPeriodLabel("2026-06", "month"), "Jun 2026");
    assert.equal(formatPeriodLabel("2026-01", "month"), "Jan 2026");
  });

  it("quarter", () => {
    assert.equal(formatPeriodLabel("2026-Q2", "quarter"), "Q2 2026");
  });

  it("year", () => {
    assert.equal(formatPeriodLabel("2026", "year"), "2026");
  });

  it("week — same month", () => {
    // 2026-W23 starts Jun 1 (Mon) → ends Jun 7 (Sun)
    assert.equal(formatPeriodLabel("2026-W23", "week"), "Jun 1–7, 2026");
  });

  it("week — spans months", () => {
    // 2026-W22 starts May 25 → ends May 31
    // Actually let's compute: May 25 is a Monday, ends May 31 (Sunday). Same month!
    // Use a week that actually spans months: 2026-W27 starts Jun 29 → Jul 5
    assert.equal(formatPeriodLabel("2026-W27", "week"), "Jun 29 – Jul 5, 2026");
  });
});

// ── comparePeriodKeys ───────────────────────────────────────────────

describe("comparePeriodKeys", () => {
  it("sorts months correctly", () => {
    assert.ok(comparePeriodKeys("2026-05", "2026-06") < 0);
    assert.ok(comparePeriodKeys("2026-06", "2026-06") === 0);
    assert.ok(comparePeriodKeys("2026-06", "2026-05") > 0);
  });

  it("sorts quarters correctly", () => {
    assert.ok(comparePeriodKeys("2025-Q4", "2026-Q1") < 0);
  });

  it("sorts weeks correctly", () => {
    assert.ok(comparePeriodKeys("2026-W01", "2026-W02") < 0);
    assert.ok(comparePeriodKeys("2026-W09", "2026-W10") < 0);
  });
});

// ── periodContainsDate ──────────────────────────────────────────────

describe("periodContainsDate", () => {
  it("month", () => {
    assert.equal(periodContainsDate("2026-06", "month", "2026-06-04"), true);
    assert.equal(periodContainsDate("2026-06", "month", "2026-05-31"), false);
  });

  it("quarter", () => {
    assert.equal(periodContainsDate("2026-Q2", "quarter", "2026-06-30"), true);
    assert.equal(periodContainsDate("2026-Q2", "quarter", "2026-07-01"), false);
  });

  it("year", () => {
    assert.equal(periodContainsDate("2026", "year", "2026-12-31"), true);
    assert.equal(periodContainsDate("2026", "year", "2027-01-01"), false);
  });
});

// ── periodStartDate / periodEndDate ─────────────────────────────────

describe("periodStartDate / periodEndDate", () => {
  it("month", () => {
    const start = periodStartDate("2026-06", "month");
    assert.equal(start.getFullYear(), 2026);
    assert.equal(start.getMonth(), 5);
    assert.equal(start.getDate(), 1);

    const end = periodEndDate("2026-06", "month");
    assert.equal(end.getDate(), 30);
  });

  it("quarter", () => {
    const start = periodStartDate("2026-Q2", "quarter");
    assert.equal(start.getMonth(), 3); // April
    assert.equal(start.getDate(), 1);

    const end = periodEndDate("2026-Q2", "quarter");
    assert.equal(end.getMonth(), 5); // June
    assert.equal(end.getDate(), 30);
  });

  it("year", () => {
    const start = periodStartDate("2026", "year");
    assert.equal(start.getMonth(), 0);
    assert.equal(start.getDate(), 1);

    const end = periodEndDate("2026", "year");
    assert.equal(end.getMonth(), 11);
    assert.equal(end.getDate(), 31);
  });

  it("week", () => {
    // W23 2026: Jun 1 (Mon) – Jun 7 (Sun)
    const start = periodStartDate("2026-W23", "week");
    assert.equal(start.getMonth(), 5); // June
    assert.equal(start.getDate(), 1);

    const end = periodEndDate("2026-W23", "week");
    assert.equal(end.getMonth(), 5);
    assert.equal(end.getDate(), 7);
  });
});

// ── periodLengthDays ────────────────────────────────────────────────

describe("periodLengthDays", () => {
  it("week = 7", () => {
    assert.equal(periodLengthDays("2026-W23", "week"), 7);
  });

  it("month (June = 30, Feb non-leap = 28)", () => {
    assert.equal(periodLengthDays("2026-06", "month"), 30);
    assert.equal(periodLengthDays("2026-02", "month"), 28);
    assert.equal(periodLengthDays("2024-02", "month"), 29); // leap
  });

  it("quarter Q2 2026 = 91 days (Apr 30 + May 31 + Jun 30)", () => {
    assert.equal(periodLengthDays("2026-Q2", "quarter"), 91);
  });

  it("year 2026 = 365", () => {
    assert.equal(periodLengthDays("2026", "year"), 365);
  });
});

// ── elapsedFractionOfPeriod ─────────────────────────────────────────

describe("elapsedFractionOfPeriod", () => {
  it("returns 0 if before period", () => {
    const asOf = new Date(2026, 4, 31); // May 31
    assert.equal(elapsedFractionOfPeriod("2026-06", "month", asOf), 0);
  });

  it("returns 1 if after period", () => {
    const asOf = new Date(2026, 6, 1); // Jul 1
    assert.equal(elapsedFractionOfPeriod("2026-06", "month", asOf), 1);
  });

  it("returns ~0.1 early in a month", () => {
    // June 4, 00:00 → 3 days elapsed out of 30
    const asOf = new Date(2026, 5, 4);
    const frac = elapsedFractionOfPeriod("2026-06", "month", asOf);
    assert.ok(frac > 0.09 && frac < 0.12, `expected ~0.1, got ${frac}`);
  });
});

// ── comparisonClipDate ──────────────────────────────────────────────

describe("comparisonClipDate", () => {
  it("month: June 4 → May 4", () => {
    const asOf = new Date(2026, 5, 4); // June 4
    const clip = comparisonClipDate("2026-06", "2026-05", "month", asOf);
    // Approximate — should be around May 4
    assert.ok(clip.startsWith("2026-05-0"), `expected ~2026-05-04, got ${clip}`);
  });

  it("year: June 4 2026 → approx June 4 2025", () => {
    const asOf = new Date(2026, 5, 4);
    const clip = comparisonClipDate("2026", "2025", "year", asOf);
    // Should be around day 155 / 365 ≈ June 4
    assert.ok(clip.startsWith("2025-06-0"), `expected ~2025-06-04, got ${clip}`);
  });
});

// ── formatPeriodShort ───────────────────────────────────────────────

describe("formatPeriodShort", () => {
  it("month → short month name", () => {
    assert.equal(formatPeriodShort("2026-06", "month"), "Jun");
  });

  it("quarter → Q label", () => {
    assert.equal(formatPeriodShort("2026-Q2", "quarter"), "Q2");
  });

  it("year → full year", () => {
    assert.equal(formatPeriodShort("2026", "year"), "2026");
  });

  it("week → month + day", () => {
    assert.equal(formatPeriodShort("2026-W23", "week"), "Jun 1");
  });
});

// ── formatPeriodYear ────────────────────────────────────────────────

describe("formatPeriodYear", () => {
  it("extracts year", () => {
    assert.equal(formatPeriodYear("2026-06", "month"), "2026");
    assert.equal(formatPeriodYear("2026-Q2", "quarter"), "2026");
    assert.equal(formatPeriodYear("2026-W23", "week"), "2026");
    assert.equal(formatPeriodYear("2026", "year"), "2026");
  });
});
