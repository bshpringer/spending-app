import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("getDb opens a db, applies schema, and creates expected tables", () => {
  const dir = mkdtempSync(join(tmpdir(), "budgeting-db-"));
  process.env.BUDGETING_DB_PATH = join(dir, "test.db");

  // Import lazily so the env var is honored.
  return import("./db.ts").then(({ getDb, closeDb }) => {
    const db = getDb();

    const tables = (db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[])
      .map((r) => r.name);

    for (const expected of [
      "account_tags",
      "accounts",
      "tags",
      "transaction_tags",
      "transactions",
    ]) {
      assert.ok(tables.includes(expected), `missing table: ${expected}`);
    }

    assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
    assert.equal(db.pragma("journal_mode", { simple: true }), "wal");

    closeDb();
    rmSync(dir, { recursive: true, force: true });
    delete process.env.BUDGETING_DB_PATH;
  });
});
