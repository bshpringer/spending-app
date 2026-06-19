import { test } from "node:test";
import assert from "node:assert/strict";
import { detectRecurring } from "./recurring.ts";
import type { Transaction } from "./types.ts";

function tx(over: Partial<Transaction> & { date: string; amount: number; name: string }): Transaction {
  return {
    id: over.id ?? `tx-${Math.random().toString(36).slice(2, 10)}`,
    dedupeKey: over.dedupeKey ?? `dk-${Math.random()}`,
    accountId: over.accountId ?? null,
    profileId: over.profileId ?? "household",
    date: over.date,
    originalDate: over.originalDate ?? over.date,
    name: over.name,
    customName: over.customName,
    amount: over.amount,
    csvAmount: over.csvAmount ?? -over.amount,
    description: over.description ?? "",
    category: over.category ?? "Subscriptions",
    note: over.note ?? "",
    ignoredFrom: over.ignoredFrom ?? "",
    taxDeductible: over.taxDeductible ?? false,
    tags: over.tags ?? [],
    userOverrides: over.userOverrides ?? {},
    importedFromCsvAt: over.importedFromCsvAt ?? "2026-01-01T00:00:00Z",
    importBatchId: over.importBatchId ?? null,
    source: over.source ?? "csv",
    plaidRaw: over.plaidRaw ?? null,
    createdAt: over.createdAt ?? "2026-01-01T00:00:00Z",
    updatedAt: over.updatedAt ?? "2026-01-01T00:00:00Z",
  };
}

const EMPTY_CATS = new Map();
const EMPTY_TAGS = new Map<string, string[]>();
const NO_DISMISS = new Set<string>();

test("detects three monthly $14.99 charges as a fixed monthly subscription", () => {
  const txs = [
    tx({ date: "2026-03-14", amount: -14.99, name: "Netflix" }),
    tx({ date: "2026-04-14", amount: -14.99, name: "Netflix" }),
    tx({ date: "2026-05-14", amount: -14.99, name: "Netflix" }),
  ];
  const out = detectRecurring(txs, [], EMPTY_CATS, EMPTY_TAGS, NO_DISMISS, { today: "2026-05-20" });
  assert.equal(out.length, 1);
  const g = out[0];
  assert.equal(g.merchant, "Netflix");
  assert.equal(g.cadence, "monthly");
  assert.equal(g.amountVariance, "fixed");
  assert.equal(g.status, "active");
  assert.ok(g.confidence > 0.7, `confidence was ${g.confidence}`);
});

test("twelve monthly utility charges with varying amounts → variable (Bill)", () => {
  const amounts = [142, 160, 175, 188, 200, 215, 231, 198, 175, 165, 150, 145];
  const txs = amounts.map((amt, i) => {
    const month = (i + 1).toString().padStart(2, "0");
    return tx({ date: `2025-${month}-15`, amount: -amt, name: "City Utility" });
  });
  const out = detectRecurring(txs, [], EMPTY_CATS, EMPTY_TAGS, NO_DISMISS, { today: "2026-01-10" });
  assert.equal(out.length, 1);
  assert.equal(out[0].cadence, "monthly");
  assert.equal(out[0].amountVariance, "variable");
});

test("weekly $8 coffee charges → cadence=weekly, monthlyEquivalent ≈ -$34.65", () => {
  const txs: Transaction[] = [];
  // 10 weekly charges starting 2026-03-01
  for (let i = 0; i < 10; i++) {
    const d = new Date("2026-03-01T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + i * 7);
    txs.push(tx({ date: d.toISOString().slice(0, 10), amount: -8, name: "Daily Grind" }));
  }
  const out = detectRecurring(txs, [], EMPTY_CATS, EMPTY_TAGS, NO_DISMISS, { today: "2026-05-05" });
  assert.equal(out.length, 1);
  assert.equal(out[0].cadence, "weekly");
  // 8 * (30.4375 / 7) ≈ 34.79
  assert.ok(Math.abs(out[0].monthlyEquivalent - -34.79) < 0.1, `got ${out[0].monthlyEquivalent}`);
});

test("irregular spacing → cadence=irregular → dropped", () => {
  // Intervals: 3, 22, 60 — median 22 falls outside every cadence window.
  const txs = [
    tx({ date: "2026-01-01", amount: -50, name: "Random Shop" }),
    tx({ date: "2026-01-04", amount: -50, name: "Random Shop" }),
    tx({ date: "2026-01-26", amount: -50, name: "Random Shop" }),
    tx({ date: "2026-03-27", amount: -50, name: "Random Shop" }),
  ];
  const out = detectRecurring(txs, [], EMPTY_CATS, EMPTY_TAGS, NO_DISMISS, { today: "2026-04-01" });
  assert.equal(out.length, 0);
});

test("monthly cadence last seen 100 days ago → status=ended", () => {
  const txs: Transaction[] = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date("2025-08-15T00:00:00Z");
    d.setUTCMonth(d.getUTCMonth() + i);
    txs.push(tx({ date: d.toISOString().slice(0, 10), amount: -19.99, name: "Old Sub" }));
  }
  // Last charge: 2026-01-15; today 100 days later: 2026-04-25
  const out = detectRecurring(txs, [], EMPTY_CATS, EMPTY_TAGS, NO_DISMISS, { today: "2026-04-25" });
  assert.equal(out.length, 1);
  assert.equal(out[0].status, "ended");
});

test("two annual $120 membership charges → detected with cadence=annual at default minOccurrences=2", () => {
  const txs = [
    tx({ date: "2025-03-04", amount: -120, name: "Annual Membership" }),
    tx({ date: "2026-03-04", amount: -120, name: "Annual Membership" }),
  ];
  const out = detectRecurring(txs, [], EMPTY_CATS, EMPTY_TAGS, NO_DISMISS, { today: "2026-03-10" });
  assert.equal(out.length, 1);
  assert.equal(out[0].cadence, "annual");
  assert.ok(Math.abs(out[0].monthlyEquivalent - -10) < 0.1, `got ${out[0].monthlyEquivalent}`);
});

test("two monthly $50 charges: detected at default, dropped at minOccurrences=3", () => {
  const txs = [
    tx({ date: "2026-04-10", amount: -50, name: "TwoTimes" }),
    tx({ date: "2026-05-10", amount: -50, name: "TwoTimes" }),
  ];
  const detected = detectRecurring(txs, [], EMPTY_CATS, EMPTY_TAGS, NO_DISMISS, { today: "2026-05-15" });
  assert.equal(detected.length, 1);
  const dropped = detectRecurring(txs, [], EMPTY_CATS, EMPTY_TAGS, NO_DISMISS, {
    today: "2026-05-15",
    minOccurrences: 3,
  });
  assert.equal(dropped.length, 0);
});

test("refund (positive amount) is skipped at detection", () => {
  const txs = [
    tx({ date: "2026-01-15", amount: -15, name: "Spotify" }),
    tx({ date: "2026-02-15", amount: -15, name: "Spotify" }),
    tx({ date: "2026-03-15", amount: -15, name: "Spotify" }),
    tx({ date: "2026-04-15", amount: -15, name: "Spotify" }),
    tx({ date: "2026-04-20", amount: +15, name: "Spotify" }), // refund — ignored
  ];
  const out = detectRecurring(txs, [], EMPTY_CATS, EMPTY_TAGS, NO_DISMISS, { today: "2026-05-01" });
  assert.equal(out.length, 1);
  assert.equal(out[0].occurrenceCount, 4);
});

test("dismissed merchant is returned with dismissed: true (not omitted)", () => {
  const txs = [
    tx({ date: "2026-03-10", amount: -15, name: "Online Store" }),
    tx({ date: "2026-04-10", amount: -15, name: "Online Store" }),
    tx({ date: "2026-05-10", amount: -15, name: "Online Store" }),
  ];
  const out = detectRecurring(
    txs,
    [],
    EMPTY_CATS,
    EMPTY_TAGS,
    new Set(["Online Store"]),
    { today: "2026-05-15" },
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].dismissed, true);
});
