import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCsv,
  parseCsvLine,
  sanitizeText,
  slugifyTag,
  makeDedupeKey,
  accountNaturalKey,
} from "./csv-import.ts";

// Fully synthetic sample — fake banks, accounts, merchants, and amounts.
const SAMPLE_CSV = `Date,Original Date,Account Type,Account Name,Account Number,Institution Name,Name,Custom Name,Amount,Description,Category,Note,Ignored From,Tax Deductible,Transaction Tags
2026-05-20,2026-05-20,Credit Card,Everyday RewardsÂ® Card,1001,Sample Bank,Acme Grocery,,64.39,ACME GROCERY 141 MAIN ST US,Groceries,,budget,,Shared
2026-05-20,2026-05-20,Cash,Checking Plus,1002,Test Credit Union,PAYMENT TO ACCT #0000 ON 05/19 VIA WEB,,455.06,PAYMENT TO ACCT #0000 ON 05/19 VIA WEB,Loan Payment,,,,
2026-05-19,2026-05-19,Investment,Brokerage,1003,Demo Brokerage,Money Market Fund,,35357,MONEY MARKET FUND,Internal Transfers,,,,
2026-05-19,2026-05-19,Credit Card,Premium CardÂ®,1004,Example Card Co,Streaming Plus,,9.99,STREAMING PLUS,Bills & Utilities,,,,
`;

test("parseCsvLine handles quoted fields with embedded commas", () => {
  const line = `2026-05-20,Credit Card,"Acme, Special",1001,"Hello ""World"",extra"`;
  const result = parseCsvLine(line);
  assert.equal(result.length, 5);
  assert.equal(result[2], "Acme, Special");
  assert.equal(result[4], 'Hello "World",extra');
});

test("sanitizeText cleans common mojibake", () => {
  assert.equal(sanitizeText("Everyday RewardsÂ® Card"), "Everyday Rewards® Card");
  assert.equal(sanitizeText("  Premium CardÂ®  "), "Premium Card®");
});

test("slugifyTag normalizes to safe ids", () => {
  assert.equal(slugifyTag("Shared"), "shared");
  assert.equal(slugifyTag("Vacation 2026!"), "vacation-2026");
  assert.equal(slugifyTag("  Wedding  "), "wedding");
});

test("makeDedupeKey is stable across whitespace and case in name/description", () => {
  const a = makeDedupeKey("2026-05-20", "1001", 64.39, "Acme Grocery", "ACME GROCERY 141");
  const b = makeDedupeKey("2026-05-20", "1001", 64.39, "  acme grocery ", "acme  grocery   141");
  assert.equal(a, b);
});

test("accountNaturalKey is consistent for the same institution/last4", () => {
  const k1 = accountNaturalKey("Sample Bank", "1001");
  const k2 = accountNaturalKey("sample bank", "1001");
  assert.equal(k1, k2);
});

test("parseCsv extracts transactions, accounts, and tags from sample", () => {
  const result = parseCsv(SAMPLE_CSV);
  assert.equal(result.transactions.length, 4);
  assert.equal(result.accounts.length, 4);
  assert.deepEqual(result.tagDisplayNames, ["Shared"]);
});

test("parseCsv sanitizes mojibake in account/institution names", () => {
  const result = parseCsv(SAMPLE_CSV);
  const visa = result.accounts.find((a) => a.accountNumberLast4 === "1001");
  assert.ok(visa);
  assert.equal(visa!.accountName, "Everyday Rewards® Card");
  const amex = result.accounts.find((a) => a.accountNumberLast4 === "1004");
  assert.equal(amex!.accountName, "Premium Card®");
});

test("parseCsv negates expense amounts by default", () => {
  const result = parseCsv(SAMPLE_CSV);
  const grocery = result.transactions.find((t) => t.name === "Acme Grocery");
  assert.ok(grocery);
  assert.equal(grocery!.csvAmount, 64.39);
  assert.equal(grocery!.amount, -64.39);
});

test("parseCsv flips Rocket Money's sign convention (negative CSV = positive income)", () => {
  // Rocket Money exports income/refunds as NEGATIVE amounts and expenses as POSITIVE.
  // We flip every sign so the app uses standard accounting convention
  // (negative = expense, positive = income).
  const incomeCsv = `Date,Original Date,Account Type,Account Name,Account Number,Institution Name,Name,Custom Name,Amount,Description,Category,Note,Ignored From,Tax Deductible,Transaction Tags
2026-05-15,2026-05-15,Cash,Checking,1234,Test Bank,Employer Payroll,,-5000,DIRECT DEPOSIT,Income,,,,
2026-05-10,2026-05-10,Cash,Checking,1234,Test Bank,Store Refund,,-25.99,REFUND,Shopping,,,,
2026-05-09,2026-05-09,Credit Card,Visa,1111,Bank,Acme Grocery,,64.39,ACME GROCERY,Groceries,,,,
`;
  const result = parseCsv(incomeCsv);
  assert.equal(result.transactions[0].csvAmount, -5000);
  assert.equal(result.transactions[0].amount, 5000);
  assert.equal(result.transactions[1].csvAmount, -25.99);
  assert.equal(result.transactions[1].amount, 25.99);
  assert.equal(result.transactions[2].csvAmount, 64.39);
  assert.equal(result.transactions[2].amount, -64.39);
});

test("parseCsv tags column splits on commas", () => {
  const multi = `Date,Original Date,Account Type,Account Name,Account Number,Institution Name,Name,Custom Name,Amount,Description,Category,Note,Ignored From,Tax Deductible,Transaction Tags
2026-05-20,2026-05-20,Credit Card,Visa,1111,Bank,Test,,10.00,TEST,Groceries,,,,"Shared, Vacation 2026"
`;
  const result = parseCsv(multi);
  assert.deepEqual(result.transactions[0].tags, ["Shared", "Vacation 2026"]);
  assert.deepEqual(result.tagDisplayNames.sort(), ["Shared", "Vacation 2026"].sort());
});

test("parseCsv preserves dedupeKey across identical re-import rows", () => {
  const result1 = parseCsv(SAMPLE_CSV);
  const result2 = parseCsv(SAMPLE_CSV);
  for (let i = 0; i < result1.transactions.length; i++) {
    assert.equal(result1.transactions[i].dedupeKey, result2.transactions[i].dedupeKey);
  }
});

test("parseCsv flags zero rows as empty file", () => {
  const result = parseCsv("");
  assert.equal(result.transactions.length, 0);
  assert.ok(result.warnings.length > 0);
});

test("parseCsv handles trailing newline and empty rows", () => {
  const trailing = SAMPLE_CSV + "\n\n";
  const result = parseCsv(trailing);
  assert.equal(result.transactions.length, 4);
});
