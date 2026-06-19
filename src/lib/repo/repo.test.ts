import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { makeAccountRepo } from "./accountRepo.ts";
import { makeTransactionRepo } from "./transactionRepo.ts";
import { makeTagRepo, slugify } from "./tagRepo.ts";
import type { ParsedAccount, ParsedTransaction } from "../types.ts";

function openTestDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const schema = readFileSync(resolve(process.cwd(), "src/lib/db-schema.sql"), "utf8");
  db.exec(schema);
  return db;
}

const sampleAccount: ParsedAccount = {
  accountName: "Test Card",
  accountNumberLast4: "1234",
  institutionName: "Test Bank",
  accountType: "Credit Card",
  naturalKey: "test-bank|test-card|1234",
};

function sampleTx(overrides: Partial<ParsedTransaction> = {}): ParsedTransaction {
  return {
    dedupeKey: "key-1",
    accountNaturalKey: sampleAccount.naturalKey,
    date: "2026-05-01",
    originalDate: "2026-05-01",
    name: "Coffee Shop",
    amount: -5.5,
    csvAmount: 5.5,
    description: "",
    category: "Food",
    note: "",
    ignoredFrom: "",
    taxDeductible: false,
    tags: ["Shared"],
    ...overrides,
  };
}

test("slugify normalizes display names", () => {
  assert.equal(slugify("Shared"), "shared");
  assert.equal(slugify("Vacation 2026!"), "vacation-2026");
  assert.equal(slugify("  Multi  Word  "), "multi-word");
});

test("accountRepo.getOrCreate is idempotent on naturalKey", () => {
  const db = openTestDb();
  const repo = makeAccountRepo(db);
  const a = repo.getOrCreate(sampleAccount);
  const b = repo.getOrCreate(sampleAccount);
  assert.equal(a.id, b.id);
  assert.equal(repo.list().length, 1);
});

test("tagRepo.ensureExists is idempotent on slug", () => {
  const db = openTestDb();
  const repo = makeTagRepo(db);
  const a = repo.ensureExists("Shared");
  const b = repo.ensureExists("Shared");
  assert.equal(a.id, "shared");
  assert.equal(b.id, "shared");
  assert.equal(repo.list().length, 1);
});

test("transactionRepo.bulkUpsert inserts then dedupes on re-import", () => {
  const db = openTestDb();
  const accounts = makeAccountRepo(db);
  const transactions = makeTransactionRepo(db);

  const account = accounts.getOrCreate(sampleAccount);
  const ids = new Map([[sampleAccount.naturalKey, account.id]]);

  const first = transactions.bulkUpsert(
    [sampleTx({ dedupeKey: "k1" }), sampleTx({ dedupeKey: "k2" })],
    ids,
  );
  assert.equal(first.newCount, 2);
  assert.equal(first.matchedCount, 0);

  const second = transactions.bulkUpsert(
    [sampleTx({ dedupeKey: "k1" }), sampleTx({ dedupeKey: "k3" })],
    ids,
  );
  assert.equal(second.newCount, 1);
  assert.equal(second.matchedCount, 1);

  assert.equal(transactions.list().length, 3);
});

test("transactionRepo persists tags via slug", () => {
  const db = openTestDb();
  const accounts = makeAccountRepo(db);
  const transactions = makeTransactionRepo(db);
  const account = accounts.getOrCreate(sampleAccount);
  const ids = new Map([[sampleAccount.naturalKey, account.id]]);

  transactions.bulkUpsert([sampleTx({ tags: ["Shared", "Vacation 2026"] })], ids);
  const [tx] = transactions.list();
  assert.deepEqual(tx.tags.sort(), ["shared", "vacation-2026"]);
});

test("transactionRepo.query filters by search across name/description/category/note", () => {
  const db = openTestDb();
  const accounts = makeAccountRepo(db);
  const transactions = makeTransactionRepo(db);
  const account = accounts.getOrCreate(sampleAccount);
  const ids = new Map([[sampleAccount.naturalKey, account.id]]);

  transactions.bulkUpsert(
    [
      sampleTx({ dedupeKey: "k1", name: "Acme Grocery", category: "Food" }),
      sampleTx({ dedupeKey: "k2", name: "Gas Station", category: "Transport" }),
      sampleTx({ dedupeKey: "k3", name: "Coffee", description: "acme cafe inside" }),
    ],
    ids,
  );

  const hits = transactions.query({ search: "ACME" });
  assert.equal(hits.length, 2);
  assert.deepEqual(hits.map((t) => t.dedupeKey).sort(), ["k1", "k3"]);
});

test("transactionRepo.query filters by account, category, and date range", () => {
  const db = openTestDb();
  const accounts = makeAccountRepo(db);
  const transactions = makeTransactionRepo(db);

  const a = accounts.getOrCreate(sampleAccount);
  const b = accounts.getOrCreate({
    ...sampleAccount,
    accountName: "Other",
    accountNumberLast4: "9999",
    naturalKey: "test-bank|other|9999",
  });
  const ids = new Map([
    [sampleAccount.naturalKey, a.id],
    ["test-bank|other|9999", b.id],
  ]);

  transactions.bulkUpsert(
    [
      sampleTx({ dedupeKey: "k1", date: "2026-01-15", originalDate: "2026-01-15", category: "Food" }),
      sampleTx({ dedupeKey: "k2", date: "2026-03-15", originalDate: "2026-03-15", category: "Transport" }),
      sampleTx({
        dedupeKey: "k3",
        date: "2026-06-15",
        originalDate: "2026-06-15",
        category: "Food",
        accountNaturalKey: "test-bank|other|9999",
      }),
    ],
    ids,
  );

  assert.equal(transactions.query({ accountIds: [a.id] }).length, 2);
  assert.equal(transactions.query({ categories: ["Food"] }).length, 2);
  assert.equal(
    transactions.query({ from: "2026-02-01", to: "2026-05-01" }).length,
    1,
  );
  // Combined
  assert.equal(
    transactions.query({ accountIds: [a.id], categories: ["Food"] }).length,
    1,
  );
});

test("transactionRepo.query tag filter respects account-level inheritance", () => {
  const db = openTestDb();
  const accounts = makeAccountRepo(db);
  const transactions = makeTransactionRepo(db);
  const tags = makeTagRepo(db);

  const a = accounts.getOrCreate(sampleAccount);
  const b = accounts.getOrCreate({
    ...sampleAccount,
    accountName: "Personal",
    accountNumberLast4: "5555",
    naturalKey: "test-bank|personal|5555",
  });
  const ids = new Map([
    [sampleAccount.naturalKey, a.id],
    ["test-bank|personal|5555", b.id],
  ]);

  // Tag account A as 'shared' at the account level — its transactions have NO tx-level tags.
  const sharedTag = tags.ensureExists("Shared");
  accounts.addTag(a.id, sharedTag.id);

  transactions.bulkUpsert(
    [
      sampleTx({ dedupeKey: "k1", tags: [] }), // on shared account, no tx tag
      sampleTx({
        dedupeKey: "k2",
        accountNaturalKey: "test-bank|personal|5555",
        tags: [],
      }), // personal account, no tags
      sampleTx({
        dedupeKey: "k3",
        accountNaturalKey: "test-bank|personal|5555",
        tags: ["Shared"], // explicit tx-level shared tag on personal account
      }),
    ],
    ids,
  );

  const hits = transactions.query({ tagIds: ["shared"] });
  assert.deepEqual(hits.map((t) => t.dedupeKey).sort(), ["k1", "k3"]);
});

test("transactionRepo.distinctCategories returns sorted unique non-empty values", () => {
  const db = openTestDb();
  const accounts = makeAccountRepo(db);
  const transactions = makeTransactionRepo(db);
  const account = accounts.getOrCreate(sampleAccount);
  const ids = new Map([[sampleAccount.naturalKey, account.id]]);

  transactions.bulkUpsert(
    [
      sampleTx({ dedupeKey: "k1", category: "Food" }),
      sampleTx({ dedupeKey: "k2", category: "Transport" }),
      sampleTx({ dedupeKey: "k3", category: "Food" }),
      sampleTx({ dedupeKey: "k4", category: "" }),
    ],
    ids,
  );

  assert.deepEqual(transactions.distinctCategories(), ["Food", "Transport"]);
});

test("accountRepo.addTag wires up the join table", () => {
  const db = openTestDb();
  const accounts = makeAccountRepo(db);
  const tags = makeTagRepo(db);
  const account = accounts.getOrCreate(sampleAccount);
  const tag = tags.ensureExists("Shared");
  accounts.addTag(account.id, tag.id);
  const refreshed = accounts.findById(account.id);
  assert.deepEqual(refreshed?.tags, ["shared"]);
  accounts.removeTag(account.id, tag.id);
  assert.deepEqual(accounts.findById(account.id)?.tags, []);
});
