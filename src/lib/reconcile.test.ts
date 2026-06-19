import { test } from "node:test";
import assert from "node:assert/strict";
import { detectReconciliations, reconcilePairKey } from "./reconcile.ts";
import type { Transaction } from "./types.ts";

function tx(over: Partial<Transaction> & { date: string; amount: number; name: string }): Transaction {
  return {
    id: over.id ?? `tx-${Math.random().toString(36).slice(2, 10)}`,
    dedupeKey: over.dedupeKey ?? `dk-${Math.random()}`,
    accountId: "accountId" in over ? (over.accountId ?? null) : "acct-1",
    profileId: over.profileId ?? "household",
    date: over.date,
    originalDate: over.originalDate ?? over.date,
    name: over.name,
    customName: over.customName,
    canonicalName: over.canonicalName,
    amount: over.amount,
    csvAmount: over.csvAmount ?? -over.amount,
    description: over.description ?? "",
    category: over.category ?? "Shopping",
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

test("identical description + same acct/amount/day → desc-exact", () => {
  const csv = tx({ id: "c1", date: "2026-05-19", amount: -63.39, name: "Amazon", description: "AMZN MKTP US" });
  const plaid = tx({ id: "p1", date: "2026-05-19", amount: -63.39, name: "Amazon", description: "AMZN MKTP US", source: "plaid" });
  const out = detectReconciliations([csv], [plaid]);
  assert.equal(out.length, 1);
  assert.equal(out[0].tier, "desc-exact");
  assert.equal(out[0].csv.id, "c1");
  assert.equal(out[0].plaid.id, "p1");
  assert.equal(out[0].daysApart, 0);
});

test("descriptions differ but merchant matches → fallback-high (the real-data workhorse)", () => {
  // Plaid enriches the raw Rocket description, so the triple key never collides.
  const csv = tx({ id: "c1", date: "2026-05-17", amount: -68.21, name: "ACME PET INSURANCE", description: "ACME PET INSURANCE 8005551234 ST" });
  const plaid = tx({ id: "p1", date: "2026-05-17", amount: -68.21, name: "Acme Pet Insurance", description: "Acme Pet Insurance", source: "plaid" });
  const out = detectReconciliations([csv], [plaid]);
  assert.equal(out.length, 1);
  assert.equal(out[0].tier, "fallback-high");
});

test("merchant fuzz clears cross-source name drift (634 QUICK STOP, INC. ↔ Quick Stop Inc.)", () => {
  const csv = tx({ id: "c1", date: "2026-05-13", amount: -44.41, name: "634 QUICK STOP, INC.", description: "634 QUICK STOP INC ANYTOWN" });
  const plaid = tx({ id: "p1", date: "2026-05-13", amount: -44.41, name: "Quick Stop Inc.", description: "Quick Stop", source: "plaid" });
  const out = detectReconciliations([csv], [plaid]);
  assert.equal(out.length, 1);
  assert.equal(out[0].tier, "fallback-high");
});

test("same acct/amount/date but unrelated merchant → fallback-medium", () => {
  const csv = tx({ id: "c1", date: "2026-05-10", amount: -38.67, name: "Pet Store", description: "PET STORE 123" });
  const plaid = tx({ id: "p1", date: "2026-05-10", amount: -38.67, name: "Gas Station", description: "Gas", source: "plaid" });
  const out = detectReconciliations([csv], [plaid]);
  assert.equal(out.length, 1);
  assert.equal(out[0].tier, "fallback-medium");
});

test("desc-exact day cap rejects a wrong-month subscription mis-pair", () => {
  // Same (acct, amount, desc) but ~6 months apart — must NOT pair at default cap.
  const csv = tx({ id: "c1", date: "2026-01-15", amount: -9.99, name: "Spotify", description: "SPOTIFY USA" });
  const plaid = tx({ id: "p1", date: "2026-07-15", amount: -9.99, name: "Spotify", description: "SPOTIFY USA", source: "plaid" });
  const out = detectReconciliations([csv], [plaid]);
  assert.equal(out.length, 0);
});

test("strict 1:1 — two CSV rows can't both claim the same Plaid row", () => {
  const csvA = tx({ id: "c1", date: "2026-05-19", amount: -20, name: "Amazon", description: "AMZN A" });
  const csvB = tx({ id: "c2", date: "2026-05-20", amount: -20, name: "Amazon", description: "AMZN B" });
  const plaid = tx({ id: "p1", date: "2026-05-20", amount: -20, name: "Amazon", description: "AMZN", source: "plaid" });
  const out = detectReconciliations([csvA, csvB], [plaid]);
  assert.equal(out.length, 1);
  assert.equal(out[0].plaid.id, "p1");
  // The closest-date CSV row (c2, Δ0) wins over c1 (Δ1).
  assert.equal(out[0].csv.id, "c2");
});

test("desc-exact bucket assigns globally closest-first, not CSV-iteration-order", () => {
  // c1 appears first but is farther; c2 is the Δ0 twin. c2 must claim p1.
  const c1 = tx({ id: "c1", date: "2026-05-10", amount: -5, name: "Sub", description: "SUB" });
  const c2 = tx({ id: "c2", date: "2026-05-13", amount: -5, name: "Sub", description: "SUB" });
  const p1 = tx({ id: "p1", date: "2026-05-13", amount: -5, name: "Sub", description: "SUB", source: "plaid" });
  const out = detectReconciliations([c1, c2], [p1]);
  assert.equal(out.length, 1);
  assert.equal(out[0].csv.id, "c2");
  assert.equal(out[0].daysApart, 0);
});

test("matching keys on canonical (swipe) date, not posted date", () => {
  // CSV posted 05-22 but swiped 05-19; Plaid posted/swiped 05-19. They pair on swipe day.
  const csv = tx({ id: "c1", date: "2026-05-22", originalDate: "2026-05-19", amount: -12, name: "Acme", description: "ACME" });
  const plaid = tx({ id: "p1", date: "2026-05-19", amount: -12, name: "Acme", description: "ACME", source: "plaid" });
  const out = detectReconciliations([csv], [plaid]);
  assert.equal(out.length, 1);
  assert.equal(out[0].daysApart, 0);
});

test("reviewedPairs suppresses an already-decided match", () => {
  const csv = tx({ id: "c1", date: "2026-05-19", amount: -63.39, name: "Amazon", description: "AMZN" });
  const plaid = tx({ id: "p1", date: "2026-05-19", amount: -63.39, name: "Amazon", description: "AMZN", source: "plaid" });
  const reviewed = new Set([reconcilePairKey("c1", "p1")]);
  const out = detectReconciliations([csv], [plaid], reviewed);
  assert.equal(out.length, 0);
});

test("null accountId never matches", () => {
  const csv = tx({ id: "c1", date: "2026-05-19", amount: -10, name: "Amazon", description: "AMZN", accountId: null });
  const plaid = tx({ id: "p1", date: "2026-05-19", amount: -10, name: "Amazon", description: "AMZN", accountId: null, source: "plaid" });
  assert.equal(detectReconciliations([csv], [plaid]).length, 0);
});

test("different account → no match even with identical everything else", () => {
  const csv = tx({ id: "c1", date: "2026-05-19", amount: -10, name: "Amazon", description: "AMZN", accountId: "acct-1" });
  const plaid = tx({ id: "p1", date: "2026-05-19", amount: -10, name: "Amazon", description: "AMZN", accountId: "acct-2", source: "plaid" });
  assert.equal(detectReconciliations([csv], [plaid]).length, 0);
});
