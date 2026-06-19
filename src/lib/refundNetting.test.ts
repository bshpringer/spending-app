import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { applyRefundNetting, pairsWithRefundsInSet } from "./refundNetting.ts";
import type { Transaction } from "./types.ts";

function makeTx(overrides: Partial<Transaction> & { id: string; amount: number }): Transaction {
  return {
    id: overrides.id,
    dedupeKey: overrides.id,
    accountId: overrides.accountId ?? "acct-1",
    profileId: "household",
    date: overrides.date ?? "2026-05-14",
    originalDate: overrides.originalDate ?? overrides.date ?? "2026-05-14",
    name: overrides.name ?? "Test Merchant",
    customName: overrides.customName,
    canonicalName: overrides.canonicalName,
    amount: overrides.amount,
    csvAmount: -overrides.amount,
    description: "",
    category: overrides.category ?? "Pets",
    note: "",
    ignoredFrom: "",
    taxDeductible: false,
    tags: [],
    userOverrides: {},
    importedFromCsvAt: "",
    importBatchId: null,
    source: "csv",
    plaidRaw: null,
    createdAt: "",
    updatedAt: "",
  };
}

describe("applyRefundNetting", () => {
  test("leaves unlinked transactions unchanged", () => {
    const txs = [makeTx({ id: "a", amount: -100 }), makeTx({ id: "b", amount: 50 })];
    const result = applyRefundNetting(txs, []);
    assert.equal(result[0].date, txs[0].date);
    assert.equal(result[1].date, txs[1].date);
  });

  test("remaps refund date and category to the expense's", () => {
    const expense = makeTx({ id: "exp", amount: -380, date: "2026-05-14", category: "Vet" });
    const refund = makeTx({ id: "ref", amount: 340, date: "2026-06-03", category: "Refunds" });
    const result = applyRefundNetting([expense, refund], [{ expenseId: "exp", refundId: "ref" }]);

    const netExpense = result.find((t) => t.id === "exp")!;
    const netRefund = result.find((t) => t.id === "ref")!;

    // Expense unchanged
    assert.equal(netExpense.date, "2026-05-14");
    assert.equal(netExpense.category, "Vet");

    // Refund gets expense's date and category
    assert.equal(netRefund.date, "2026-05-14");
    assert.equal(netRefund.category, "Vet");

    // Amount unchanged — netting falls out of bucket math
    assert.equal(netRefund.amount, 340);
  });

  test("refund accountId is NOT remapped on cross-account refund", () => {
    const expense = makeTx({ id: "exp", amount: -380, date: "2026-05-14", accountId: "credit-card" });
    const refund = makeTx({ id: "ref", amount: 340, date: "2026-06-03", accountId: "checking" });
    const result = applyRefundNetting([expense, refund], [{ expenseId: "exp", refundId: "ref" }]);

    const netRefund = result.find((t) => t.id === "ref")!;
    // Date/category follow expense — accountId stays on refund's own account
    assert.equal(netRefund.date, expense.date);
    assert.equal(netRefund.accountId, "checking");
  });

  test("multiple refunds linked to one expense all net into expense bucket", () => {
    const expense = makeTx({ id: "exp", amount: -380, date: "2026-05-14", category: "Vet" });
    const ref1 = makeTx({ id: "ref1", amount: 200, date: "2026-06-01" });
    const ref2 = makeTx({ id: "ref2", amount: 140, date: "2026-06-15" });
    const result = applyRefundNetting([expense, ref1, ref2], [
      { expenseId: "exp", refundId: "ref1" },
      { expenseId: "exp", refundId: "ref2" },
    ]);
    const nr1 = result.find((t) => t.id === "ref1")!;
    const nr2 = result.find((t) => t.id === "ref2")!;
    assert.equal(nr1.date, "2026-05-14");
    assert.equal(nr2.date, "2026-05-14");
    assert.equal(nr1.category, "Vet");
    assert.equal(nr2.category, "Vet");
  });

  test("refund with missing expense (pre-load edge case) stays on its own date", () => {
    // Expense is NOT in the tx set (out-of-window) — refund should not crash, stays put
    const refund = makeTx({ id: "ref", amount: 340, date: "2026-06-03" });
    const result = applyRefundNetting([refund], [{ expenseId: "missing-exp", refundId: "ref" }]);
    assert.equal(result[0].date, "2026-06-03"); // unchanged — expense not in set
  });
});

describe("pairsWithRefundsInSet", () => {
  test("returns pairs where refund is in the tx set", () => {
    const expense = makeTx({ id: "exp", amount: -100 });
    const refund = makeTx({ id: "ref", amount: 100 });
    const { pairs, missingExpenseIds } = pairsWithRefundsInSet(
      [expense, refund],
      [{ expenseId: "exp", refundId: "ref" }],
    );
    assert.equal(pairs.length, 1);
    assert.equal(missingExpenseIds.length, 0);
  });

  test("identifies missing expense ids when expense is out of window", () => {
    const refund = makeTx({ id: "ref", amount: 100 });
    // expense is NOT in the tx set (window too narrow)
    const { pairs, missingExpenseIds } = pairsWithRefundsInSet(
      [refund],
      [{ expenseId: "exp", refundId: "ref" }],
    );
    assert.equal(pairs.length, 1);
    assert.deepEqual(missingExpenseIds, ["exp"]);
  });

  test("skips pairs where refund is not in the window", () => {
    const expense = makeTx({ id: "exp", amount: -100 });
    // refund is NOT in the tx set
    const { pairs, missingExpenseIds } = pairsWithRefundsInSet(
      [expense],
      [{ expenseId: "exp", refundId: "ref" }],
    );
    assert.equal(pairs.length, 0);
    assert.equal(missingExpenseIds.length, 0);
  });
});

// Integration: verify netting produces correct bucket math for the vet example
describe("netting bucket math (vet example)", () => {
  test("May bucket shows net +40 spend, June shows +0 from this pair", () => {
    const expense = makeTx({ id: "exp", amount: -380, date: "2026-05-14", category: "Vet" });
    const refund = makeTx({ id: "ref", amount: 340, date: "2026-06-03", category: "Vet" });

    const netted = applyRefundNetting([expense, refund], [{ expenseId: "exp", refundId: "ref" }]);

    const byMonth: Record<string, number> = {};
    for (const t of netted) {
      const m = t.date.slice(0, 7);
      byMonth[m] = (byMonth[m] ?? 0) - t.amount; // spend = -amount
    }

    // May: -(-380) + -(340) = 380 - 340 = 40
    assert.equal(byMonth["2026-05"], 40);
    // June: refund remapped to May, so nothing from this pair in June
    assert.equal(byMonth["2026-06"] ?? 0, 0);
  });
});
