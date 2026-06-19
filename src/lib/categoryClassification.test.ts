import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyCategoryName } from "./categoryClassification.ts";

test("income-like names classify as income", () => {
  assert.equal(classifyCategoryName("Interest"), "income");
  assert.equal(classifyCategoryName("Interest Income"), "income");
  assert.equal(classifyCategoryName("Dividends"), "income");
  assert.equal(classifyCategoryName("Payroll"), "income");
  assert.equal(classifyCategoryName("Salary"), "income");
});

test("transfer / card-payment names classify as ignored", () => {
  assert.equal(classifyCategoryName("Transfer In"), "ignored");
  assert.equal(classifyCategoryName("Internal Transfers"), "ignored");
  assert.equal(classifyCategoryName("Credit Card Payment"), "ignored");
});

test("ordinary spending names default to expense", () => {
  assert.equal(classifyCategoryName("Groceries"), "expense");
  assert.equal(classifyCategoryName("Dining & Drinks"), "expense");
  assert.equal(classifyCategoryName("Uncategorized"), "expense");
});
