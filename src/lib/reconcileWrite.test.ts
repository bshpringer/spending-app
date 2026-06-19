import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyReconciliation } from "./reconcileWrite.ts";

type DB = InstanceType<typeof Database>;

function openTestDb(): DB {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(resolve(process.cwd(), "src/lib/db-schema.sql"), "utf8"));
  return db;
}

let seq = 0;
function seedTx(
  db: DB,
  over: Partial<{
    id: string; category: string; canonicalName: string | null; amount: number;
    plaidTransactionId: string | null; plaidRawFull: string | null; source: string;
  }> = {},
): string {
  const id = over.id ?? `tx-${++seq}`;
  db.prepare(
    `INSERT INTO transactions
       (id, dedupeKey, accountId, date, originalDate, name, canonicalName, amount, csvAmount,
        category, source, plaidTransactionId, plaidRawFull, importedFromCsvAt, createdAt, updatedAt)
     VALUES (?, ?, NULL, '2026-05-19', '2026-05-19', 'Amazon', ?, ?, ?, ?, ?, ?, ?, '', '', '')`,
  ).run(
    id, `dk-${id}`, over.canonicalName ?? null, over.amount ?? -10, -(over.amount ?? -10),
    over.category ?? "", over.source ?? "csv", over.plaidTransactionId ?? null, over.plaidRawFull ?? null,
  );
  return id;
}

test("enrich-empty-only: fills blank category + canonicalName, stamps plaid fields", () => {
  const db = openTestDb();
  const csvId = seedTx(db, { category: "", canonicalName: null });

  const res = applyReconciliation(db, csvId, {
    plaidTransactionId: "p-1",
    plaidRaw: '{"k":1}',
    plaidRawFull: '{"full":true}',
    category: "Shopping",
    canonicalName: "Amazon",
  });

  const row = db.prepare(`SELECT * FROM transactions WHERE id = ?`).get(csvId) as any;
  assert.equal(row.plaidTransactionId, "p-1");
  assert.equal(row.plaidRawFull, '{"full":true}');
  assert.equal(row.category, "Shopping");
  assert.equal(row.canonicalName, "Amazon");
  assert.ok(res.enrichedFields.includes("category"));
  assert.equal(res.deletedExistingPlaidRow, false);
});

test("does NOT clobber a hand-set category/canonicalName", () => {
  const db = openTestDb();
  const csvId = seedTx(db, { category: "Pets", canonicalName: "My Vet" });

  const res = applyReconciliation(db, csvId, {
    plaidTransactionId: "p-2",
    plaidRaw: null,
    plaidRawFull: null,
    category: "General Services",
    canonicalName: "White Plains Veterinary",
  });

  const row = db.prepare(`SELECT category, canonicalName FROM transactions WHERE id = ?`).get(csvId) as any;
  assert.equal(row.category, "Pets");
  assert.equal(row.canonicalName, "My Vet");
  assert.ok(!res.enrichedFields.includes("category"));
  assert.ok(!res.enrichedFields.includes("canonicalName"));
});

test("'Uncategorized' counts as blank and gets filled", () => {
  const db = openTestDb();
  const csvId = seedTx(db, { category: "Uncategorized" });
  applyReconciliation(db, csvId, { plaidTransactionId: "p-3", plaidRaw: null, plaidRawFull: null, category: "Shopping" });
  const row = db.prepare(`SELECT category FROM transactions WHERE id = ?`).get(csvId) as any;
  assert.equal(row.category, "Shopping");
});

test("overwrite opt-in clobbers a non-blank field", () => {
  const db = openTestDb();
  const csvId = seedTx(db, { category: "Pets" });
  applyReconciliation(
    db, csvId,
    { plaidTransactionId: "p-4", plaidRaw: null, plaidRawFull: null, category: "General Services" },
    { overwriteCategory: true },
  );
  const row = db.prepare(`SELECT category FROM transactions WHERE id = ?`).get(csvId) as any;
  assert.equal(row.category, "General Services");
});

test("survivor already linked → plaidTransactionId not overwritten", () => {
  const db = openTestDb();
  const csvId = seedTx(db, { plaidTransactionId: "existing-link" });
  const res = applyReconciliation(db, csvId, { plaidTransactionId: "p-5", plaidRaw: null, plaidRawFull: null });
  const row = db.prepare(`SELECT plaidTransactionId FROM transactions WHERE id = ?`).get(csvId) as any;
  assert.equal(row.plaidTransactionId, "existing-link");
  assert.ok(!res.enrichedFields.includes("plaidTransactionId"));
});

test("Q3: committed Plaid twin is deleted + its refund FK re-pointed onto survivor", () => {
  const db = openTestDb();
  const csvId = seedTx(db, { id: "csv", category: "" });
  // A committed Plaid row already carrying p-twin, in a confirmed refund pair.
  const plaidTwinId = seedTx(db, { id: "plaidtwin", source: "plaid", plaidTransactionId: "p-twin", amount: -10 });
  const refundPartner = seedTx(db, { id: "refund", amount: 10 });
  db.prepare(`INSERT INTO refund_matches (expenseId, refundId, status, createdAt) VALUES (?, ?, 'confirmed', '')`).run(
    plaidTwinId, refundPartner,
  );

  const res = applyReconciliation(db, csvId, {
    plaidTransactionId: "p-twin", // same id the committed twin holds
    plaidRaw: null,
    plaidRawFull: '{"full":1}',
    category: "Shopping",
  });

  // Twin gone; survivor now holds the link + enrichment.
  assert.equal((db.prepare(`SELECT COUNT(*) n FROM transactions WHERE id = ?`).get(plaidTwinId) as any).n, 0);
  const surv = db.prepare(`SELECT plaidTransactionId, category FROM transactions WHERE id = ?`).get(csvId) as any;
  assert.equal(surv.plaidTransactionId, "p-twin");
  assert.equal(surv.category, "Shopping");
  // Refund pair re-pointed from twin → survivor.
  const pair = db.prepare(`SELECT expenseId FROM refund_matches WHERE refundId = ?`).get(refundPartner) as any;
  assert.equal(pair.expenseId, csvId);
  assert.equal(res.deletedExistingPlaidRow, true);
  assert.equal(res.repointedFkCount, 1);
});

test("throws if survivor does not exist", () => {
  const db = openTestDb();
  assert.throws(
    () => applyReconciliation(db, "nope", { plaidTransactionId: "p", plaidRaw: null, plaidRawFull: null }),
    /survivor transaction nope not found/,
  );
});
