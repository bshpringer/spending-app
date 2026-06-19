import { test } from "node:test";
import assert from "node:assert/strict";
import { detectRefunds, pairKey } from "./refunds.ts";
import type { Transaction, Category } from "./types.ts";

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

const EMPTY_CATS = new Map<string, Category>();
const EMPTY_TAGS = new Map<string, string[]>();
const NONE = new Set<string>();

test("same-merchant exact-amount 1d apart → high confidence", () => {
  const expense = tx({ id: "e1", date: "2026-04-10", amount: -29.99, name: "Amazon" });
  const refund  = tx({ id: "r1", date: "2026-04-11", amount: +29.99, name: "Amazon" });
  const out = detectRefunds([expense, refund], [], EMPTY_CATS, EMPTY_TAGS, NONE, NONE);
  assert.equal(out.length, 1);
  assert.equal(out[0].confidence, "high");
  assert.equal(out[0].expense.id, "e1");
  assert.equal(out[0].refund.id, "r1");
  assert.equal(out[0].daysBetween, 1);
});

test("different merchant string, same account, exact amount, 1d apart → low confidence (subscription credit case)", () => {
  const expense = tx({ id: "e1", date: "2026-02-19", amount: -9.99, name: "Uber" });
  const refund  = tx({ id: "r1", date: "2026-02-20", amount: +9.99, name: "Subscription Credit" });
  const out = detectRefunds([expense, refund], [], EMPTY_CATS, EMPTY_TAGS, NONE, NONE);
  assert.equal(out.length, 1);
  assert.equal(out[0].confidence, "low");
});

test("window exceeded → no suggestion", () => {
  // 90 days apart with default window of 60
  const expense = tx({ id: "e1", date: "2026-01-01", amount: -50, name: "Amazon" });
  const refund  = tx({ id: "r1", date: "2026-04-01", amount: +50, name: "Amazon" });
  const out = detectRefunds([expense, refund], [], EMPTY_CATS, EMPTY_TAGS, NONE, NONE);
  assert.equal(out.length, 0);
});

test("different account → no suggestion (auto-detect requires account match)", () => {
  const expense = tx({ id: "e1", date: "2026-04-10", amount: -29.99, name: "Amazon", accountId: "acct-1" });
  const refund  = tx({ id: "r1", date: "2026-04-11", amount: +29.99, name: "Amazon", accountId: "acct-2" });
  const out = detectRefunds([expense, refund], [], EMPTY_CATS, EMPTY_TAGS, NONE, NONE);
  assert.equal(out.length, 0);
});

test("excluded expense → not in candidate pool", () => {
  const expense = tx({ id: "e1", date: "2026-04-10", amount: -29.99, name: "Amazon", userOverrides: { excluded: true } });
  const refund  = tx({ id: "r1", date: "2026-04-11", amount: +29.99, name: "Amazon" });
  const out = detectRefunds([expense, refund], [], EMPTY_CATS, EMPTY_TAGS, NONE, NONE);
  assert.equal(out.length, 0);
});

test("pair already confirmed → not re-suggested AND blocks either side from matching anything else", () => {
  const expense = tx({ id: "e1", date: "2026-04-10", amount: -29.99, name: "Amazon" });
  const refund  = tx({ id: "r1", date: "2026-04-11", amount: +29.99, name: "Amazon" });
  // Another candidate refund that would otherwise match this expense
  const otherRefund = tx({ id: "r2", date: "2026-04-12", amount: +29.99, name: "Amazon" });
  const confirmed = new Set([pairKey("e1", "r1")]);
  const out = detectRefunds([expense, refund, otherRefund], [], EMPTY_CATS, EMPTY_TAGS, confirmed, NONE);
  assert.equal(out.length, 0, "neither side should appear once a confirmed link exists");
});

test("pair in rejected set → not suggested (but other candidates can still be suggested)", () => {
  const expense = tx({ id: "e1", date: "2026-04-10", amount: -29.99, name: "Amazon" });
  const r1 = tx({ id: "r1", date: "2026-04-11", amount: +29.99, name: "Amazon" });
  const r2 = tx({ id: "r2", date: "2026-04-12", amount: +29.99, name: "Amazon" });
  const rejected = new Set([pairKey("e1", "r1")]);
  const out = detectRefunds([expense, r1, r2], [], EMPTY_CATS, EMPTY_TAGS, NONE, rejected);
  assert.equal(out.length, 1);
  assert.equal(out[0].refund.id, "r2");
});

test("one refund matching three same-amount expenses emits a group sharing the same refundId", () => {
  const e1 = tx({ id: "e1", date: "2026-04-08", amount: -29.99, name: "Amazon" });
  const e2 = tx({ id: "e2", date: "2026-04-09", amount: -29.99, name: "Amazon" });
  const e3 = tx({ id: "e3", date: "2026-04-10", amount: -29.99, name: "Amazon" });
  const refund = tx({ id: "r1", date: "2026-04-15", amount: +29.99, name: "Amazon" });
  const out = detectRefunds([e1, e2, e3, refund], [], EMPTY_CATS, EMPTY_TAGS, NONE, NONE);
  assert.equal(out.length, 3);
  for (const s of out) assert.equal(s.refund.id, "r1");
  const expenseIds = new Set(out.map((s) => s.expense.id));
  assert.deepEqual([...expenseIds].sort(), ["e1", "e2", "e3"]);
});

test("refund predates expense → not suggested", () => {
  const expense = tx({ id: "e1", date: "2026-04-15", amount: -29.99, name: "Amazon" });
  const refund  = tx({ id: "r1", date: "2026-04-10", amount: +29.99, name: "Amazon" });
  const out = detectRefunds([expense, refund], [], EMPTY_CATS, EMPTY_TAGS, NONE, NONE);
  assert.equal(out.length, 0);
});

test("null accountId on either side → skipped by auto-detect", () => {
  const expense = tx({ id: "e1", date: "2026-04-10", amount: -29.99, name: "Amazon", accountId: null });
  const refund  = tx({ id: "r1", date: "2026-04-11", amount: +29.99, name: "Amazon", accountId: "acct-1" });
  const out = detectRefunds([expense, refund], [], EMPTY_CATS, EMPTY_TAGS, NONE, NONE);
  assert.equal(out.length, 0);
});
