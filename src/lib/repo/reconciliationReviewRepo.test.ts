import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { makeAccountRepo } from "./accountRepo.ts";
import { makeTransactionRepo } from "./transactionRepo.ts";
import { makeReconciliationReviewRepo } from "./reconciliationReviewRepo.ts";
import { reconcilePairKey } from "../reconcile.ts";
import type { ParsedAccount, ParsedTransaction } from "../types.ts";

function openTestDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(resolve(process.cwd(), "src/lib/db-schema.sql"), "utf8"));
  return db;
}

const sampleAccount: ParsedAccount = {
  accountName: "Test Card",
  accountNumberLast4: "1234",
  institutionName: "Test Bank",
  accountType: "Credit Card",
  naturalKey: "test-bank|test-card|1234",
};

function sampleTx(over: Partial<ParsedTransaction> = {}): ParsedTransaction {
  return {
    dedupeKey: "k1", accountNaturalKey: sampleAccount.naturalKey, date: "2026-05-01",
    originalDate: "2026-05-01", name: "Amazon", amount: -10, csvAmount: 10, description: "AMZN",
    category: "Shopping", note: "", ignoredFrom: "", taxDeductible: false, tags: [], ...over,
  };
}

/** Insert one CSV transaction and return its generated id. */
function seedCsvTx(db: InstanceType<typeof Database>): string {
  const accounts = makeAccountRepo(db);
  const transactions = makeTransactionRepo(db);
  const account = accounts.getOrCreate(sampleAccount);
  transactions.bulkUpsert([sampleTx()], new Map([[sampleAccount.naturalKey, account.id]]));
  return transactions.list()[0].id;
}

test("markReconciled / markRejected round-trip + status update", () => {
  const db = openTestDb();
  const csvId = seedCsvTx(db);
  const repo = makeReconciliationReviewRepo(db);
  const plaidTxnId = "plaid-txn-abc";

  repo.markReconciled(csvId, plaidTxnId);
  let rows = repo.list();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "reconciled");
  assert.equal(rows[0].plaidTransactionId, plaidTxnId);

  // Same pair, new decision → upsert in place (no duplicate row).
  repo.markRejected(csvId, plaidTxnId);
  rows = repo.list();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "rejected");
});

test("reviewedPairKeys unions both statuses and matches reconcilePairKey", () => {
  const db = openTestDb();
  const csvId = seedCsvTx(db);
  const repo = makeReconciliationReviewRepo(db);

  repo.markReconciled(csvId, "p1");
  repo.markRejected(csvId, "p2");

  const keys = repo.reviewedPairKeys();
  assert.equal(keys.size, 2);
  assert.ok(keys.has(reconcilePairKey(csvId, "p1")));
  assert.ok(keys.has(reconcilePairKey(csvId, "p2")));
});

test("unmark removes the decision (Restore)", () => {
  const db = openTestDb();
  const csvId = seedCsvTx(db);
  const repo = makeReconciliationReviewRepo(db);

  repo.markReconciled(csvId, "p1");
  repo.unmark(csvId, "p1");
  assert.equal(repo.list().length, 0);
  assert.equal(repo.reviewedPairKeys().size, 0);
});

test("FK cascade: deleting the CSV transaction drops its review rows", () => {
  const db = openTestDb();
  const csvId = seedCsvTx(db);
  const repo = makeReconciliationReviewRepo(db);

  repo.markReconciled(csvId, "p1");
  assert.equal(repo.list().length, 1);

  db.prepare(`DELETE FROM transactions WHERE id = ?`).run(csvId);
  assert.equal(repo.list().length, 0);
});
