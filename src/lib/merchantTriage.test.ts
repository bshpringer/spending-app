import { test } from "node:test";
import assert from "node:assert/strict";
import type { Transaction } from "./types.ts";
import { buildTriageClusters, proposeCanonicalName } from "./merchantTriage.ts";

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

test("clusters variants of the same merchant under one stem", () => {
  const txns = [
    tx({ date: "2026-01-05", amount: -12, name: "FRESH BOWL 1085 TOWN" }),
    tx({ date: "2026-02-05", amount: -13, name: "FRESH BOWL 2203 TOWN" }),
    tx({ date: "2026-03-05", amount: -14, name: "TACO SHOP 0823" }),
  ];
  const clusters = buildTriageClusters(txns, new Set());
  assert.equal(clusters.length, 2);
  // Biggest cluster first
  assert.equal(clusters[0].txnCount, 2);
  assert.equal(clusters[0].variantCount, 2);
  assert.equal(clusters[0].totalAbsAmount, 25);
  assert.equal(clusters[0].firstDate, "2026-01-05");
  assert.equal(clusters[0].lastDate, "2026-02-05");
});

test("skips reconciled, excluded, and one-time rows", () => {
  const txns = [
    tx({ date: "2026-01-05", amount: -10, name: "CAFE ONE 1", canonicalName: "Cafe One" }),
    tx({ date: "2026-01-06", amount: -10, name: "TRANSFER A", userOverrides: { excluded: true } }),
    tx({ date: "2026-01-07", amount: -10, name: "EVENT VENUE", userOverrides: { oneTime: true } }),
    tx({ date: "2026-01-08", amount: -10, name: "CHICKEN SHOP 4217" }),
  ];
  const clusters = buildTriageClusters(txns, new Set());
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].stem, "chicken shop");
});

test("splits source patterns by transaction source", () => {
  const txns = [
    tx({ date: "2026-01-05", amount: -10, name: "TRANSIT CO PAYGO", source: "csv" }),
    tx({ date: "2026-01-06", amount: -10, name: "TRANSIT*CO PAYGO", source: "plaid" }),
  ];
  const clusters = buildTriageClusters(txns, new Set());
  assert.equal(clusters.length, 1);
  assert.deepEqual(clusters[0].rocketPatterns, ["TRANSIT CO PAYGO"]);
  assert.deepEqual(clusters[0].plaidPatterns, ["TRANSIT*CO PAYGO"]);
});

test("same raw key from both sources lands in both pattern lists", () => {
  const txns = [
    tx({ date: "2026-01-05", amount: -10, name: "Netflix", source: "csv" }),
    tx({ date: "2026-01-06", amount: -10, name: "Netflix", source: "plaid" }),
  ];
  const clusters = buildTriageClusters(txns, new Set());
  assert.deepEqual(clusters[0].rocketPatterns, ["Netflix"]);
  assert.deepEqual(clusters[0].plaidPatterns, ["Netflix"]);
});

test("marks dismissed clusters", () => {
  const txns = [tx({ date: "2026-01-05", amount: -10, name: "ONLINE BANKING TRANSFER" })];
  const clusters = buildTriageClusters(txns, new Set(["online banking transfer"]));
  assert.equal(clusters[0].dismissed, true);
});

test("uses customName over name as the merchant key", () => {
  const txns = [
    tx({ date: "2026-01-05", amount: -10, name: "SQ *COFFEE 991", customName: "Local Coffee" }),
    tx({ date: "2026-01-06", amount: -10, name: "SQ *COFFEE 882", customName: "Local Coffee" }),
  ];
  const clusters = buildTriageClusters(txns, new Set());
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].label, "Local Coffee");
  assert.equal(clusters[0].proposedCanonicalName, "Local Coffee");
});

test("proposeCanonicalName keeps a single clean raw name, title-cases shouty stems", () => {
  assert.equal(proposeCanonicalName("fresh bowl", ["FRESH BOWL 1085", "FRESH BOWL 220"]), "Fresh Bowl");
  assert.equal(proposeCanonicalName("netflix", ["Netflix"]), "Netflix");
  assert.equal(proposeCanonicalName("chicken shop", ["CHICKEN SHOP 42"]), "Chicken Shop");
});

test("proposed category is the mode, ignoring empty and Uncategorized", () => {
  const txns = [
    tx({ date: "2026-01-05", amount: -10, name: "CORNER BAKERY 1", category: "Dining & Drinks" }),
    tx({ date: "2026-01-06", amount: -10, name: "CORNER BAKERY 1", category: "" }),
    tx({ date: "2026-01-07", amount: -10, name: "CORNER BAKERY 1", category: "Uncategorized" }),
    tx({ date: "2026-01-08", amount: -10, name: "CORNER BAKERY 1", category: "Dining & Drinks" }),
  ];
  const clusters = buildTriageClusters(txns, new Set());
  assert.equal(clusters[0].proposedCategory, "Dining & Drinks");
});
