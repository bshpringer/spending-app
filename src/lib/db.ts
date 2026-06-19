import Database from "better-sqlite3";
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { normalizeMerchantStem } from "./merchantReconcile.ts";
import { backfillCategoryRows } from "./categoryClassification.ts";
import { DEFAULT_PROFILE_ID, DEFAULT_USER_ID } from "./constants.ts";

const DB_PATH = process.env.BUDGETING_DB_PATH ?? resolve(process.cwd(), "data/budgeting.db");
const SCHEMA_PATH = resolve(process.cwd(), "src/lib/db-schema.sql");

let instance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (instance) return instance;

  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const schema = readFileSync(SCHEMA_PATH, "utf8");
  db.exec(schema);

  // Migrations: add columns to existing transactions table if missing. SQLite's
  // ALTER TABLE ADD COLUMN has no IF NOT EXISTS, so inspect pragma first.
  const txCols = db.prepare(`PRAGMA table_info(transactions)`).all() as { name: string }[];
  const colNames = new Set(txCols.map((c) => c.name));
  if (!colNames.has("importBatchId")) {
    db.exec(`ALTER TABLE transactions ADD COLUMN importBatchId TEXT`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_transactions_importBatchId ON transactions(importBatchId)`);
  }
  if (!colNames.has("source")) {
    db.exec(`ALTER TABLE transactions ADD COLUMN source TEXT NOT NULL DEFAULT 'csv'`);
  }
  if (!colNames.has("profileId")) {
    db.exec(`ALTER TABLE transactions ADD COLUMN profileId TEXT`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_transactions_profileId ON transactions(profileId)`);
  }
  if (!colNames.has("plaidTransactionId")) {
    db.exec(`ALTER TABLE transactions ADD COLUMN plaidTransactionId TEXT`);
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_plaid
       ON transactions(plaidTransactionId)
       WHERE plaidTransactionId IS NOT NULL`,
    );
  }

  // Curated raw Plaid payload. Lets the pending→posted linker key off the
  // exact `pending_transaction_id` Plaid sends, and gives the /duplicates UI
  // disambiguators (reference_number, authorized_datetime, etc).
  if (!colNames.has("plaidRaw")) {
    db.exec(`ALTER TABLE transactions ADD COLUMN plaidRaw TEXT`);
  }

  // Full untouched Plaid `Transaction` payload (verbatim JSON.stringify(txn)).
  // Belt-and-suspenders companion to the curated `plaidRaw` — the curated
  // subset stays the indexed/typed access path; this column exists so we never
  // again lose a field we didn't know we'd want. Backfilled lazily via
  // /api/plaid/backfill-raw; new rows get it at write time.
  if (!colNames.has("plaidRawFull")) {
    db.exec(`ALTER TABLE transactions ADD COLUMN plaidRawFull TEXT`);
  }
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_transactions_plaid_pending_txn
     ON transactions(json_extract(plaidRaw, '$.pendingTransactionId'))
     WHERE plaidRaw IS NOT NULL`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_transactions_plaid_reference
     ON transactions(json_extract(plaidRaw, '$.referenceNumber'))
     WHERE plaidRaw IS NOT NULL`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_transactions_plaid_merchant_entity
     ON transactions(json_extract(plaidRaw, '$.merchantEntityId'))
     WHERE plaidRaw IS NOT NULL`,
  );

  // plaid_staging_removals.replacementHint — annotation set at staging-write
  // time when an `added` row in the same batch looks like the pending→posted
  // replacement for a removal (same accountId + exact amount + ±5 days). Lets
  // the user see "likely replaced by X" inline before confirming Delete.
  const removalCols = db.prepare(`PRAGMA table_info(plaid_staging_removals)`).all() as { name: string }[];
  const removalColNames = new Set(removalCols.map((c) => c.name));
  if (!removalColNames.has("replacementHint")) {
    db.exec(`ALTER TABLE plaid_staging_removals ADD COLUMN replacementHint TEXT`);
  }

  // plaid_items.pendingCursor — set by the staging-write step; swapped into
  // `cursor` only when the user commits the staged batch.
  const plaidItemCols = db.prepare(`PRAGMA table_info(plaid_items)`).all() as { name: string }[];
  const plaidItemColNames = new Set(plaidItemCols.map((c) => c.name));
  if (!plaidItemColNames.has("pendingCursor")) {
    db.exec(`ALTER TABLE plaid_items ADD COLUMN pendingCursor TEXT`);
  }
  if (!plaidItemColNames.has("sortOrder")) {
    db.exec(`ALTER TABLE plaid_items ADD COLUMN sortOrder INTEGER`);
    // Backfill: seed sortOrder by createdAt so the existing display order is
    // preserved as the initial user-visible order.
    db.exec(`
      UPDATE plaid_items
         SET sortOrder = (
           SELECT COUNT(*) FROM plaid_items p2
            WHERE p2.createdAt < plaid_items.createdAt
              OR (p2.createdAt = plaid_items.createdAt AND p2.itemId <= plaid_items.itemId)
         ) - 1
       WHERE sortOrder IS NULL
    `);
  }

  // Phase 2: canonicalName on transactions for the alias-resolved display name.
  if (!colNames.has("canonicalName")) {
    db.exec(`ALTER TABLE transactions ADD COLUMN canonicalName TEXT`);
  }

  // Phase 2: plaid_staging gains `mode` (commit vs reference reconciliation pull),
  // `canonicalName` (alias pre-fill), and `prefilledFromMediumAlias` (review flag).
  const plaidStagingCols = db.prepare(`PRAGMA table_info(plaid_staging)`).all() as { name: string }[];
  const plaidStagingColNames = new Set(plaidStagingCols.map((c) => c.name));
  if (!plaidStagingColNames.has("mode")) {
    db.exec(`ALTER TABLE plaid_staging ADD COLUMN mode TEXT NOT NULL DEFAULT 'commit'`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_plaid_staging_mode ON plaid_staging(mode)`);
  }
  if (!plaidStagingColNames.has("canonicalName")) {
    db.exec(`ALTER TABLE plaid_staging ADD COLUMN canonicalName TEXT`);
  }
  if (!plaidStagingColNames.has("prefilledFromMediumAlias")) {
    db.exec(`ALTER TABLE plaid_staging ADD COLUMN prefilledFromMediumAlias INTEGER NOT NULL DEFAULT 0`);
  }
  if (!plaidStagingColNames.has("plaidRaw")) {
    db.exec(`ALTER TABLE plaid_staging ADD COLUMN plaidRaw TEXT`);
  }
  if (!plaidStagingColNames.has("plaidRawFull")) {
    db.exec(`ALTER TABLE plaid_staging ADD COLUMN plaidRawFull TEXT`);
  }
  // replacesTransactionId: when set, commit-batch deletes the referenced
  // transactions row and inherits its user edits onto the inserted posted
  // row. Populated by the pending→posted linker.
  if (!plaidStagingColNames.has("replacesTransactionId")) {
    db.exec(`ALTER TABLE plaid_staging ADD COLUMN replacesTransactionId TEXT`);
  }
  // Carries the matched pending transaction's userOverrides (excluded,
  // oneTime, customName, category override, etc.) through to commit-batch so
  // they aren't lost when the pending row is deleted and replaced by the
  // posted one.
  if (!plaidStagingColNames.has("inheritedOverrides")) {
    db.exec(`ALTER TABLE plaid_staging ADD COLUMN inheritedOverrides TEXT`);
  }

  // plaid_staging: the unique index on (itemId, plaidTransactionId) — without
  // `mode` — caused commit-mode inserts to silently collide with existing
  // reference-mode rows for the same Plaid transaction, dropping sync results.
  // Detect the old 2-column shape and drop it; the CREATE INDEX IF NOT EXISTS
  // in schema.sql on the next boot recreates it with the 3-column shape. (We
  // can't change a sqlite index in place; drop-and-recreate is the path.)
  const stagingIdxInfo = db
    .prepare(`PRAGMA index_info('idx_plaid_staging_plaid_txn')`)
    .all() as { name: string }[];
  const stagingIdxCols = stagingIdxInfo.map((r) => r.name);
  if (stagingIdxCols.length > 0 && !stagingIdxCols.includes("mode")) {
    db.exec(`DROP INDEX idx_plaid_staging_plaid_txn`);
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_plaid_staging_plaid_txn
       ON plaid_staging(itemId, plaidTransactionId, mode)`,
    );
  }

  // merchant_alias_source: add normalizedStem column for stem-based lookup at
  // Plaid sync time. ACH-style merchant strings carry per-transaction IDs that
  // would never exact-match a stored sourcePattern; matching on the normalized
  // stem (computed by the same normalizer the wizard's clustering uses) makes
  // future variants of the same merchant pick up the alias automatically.
  const aliasSourceCols = db
    .prepare(`PRAGMA table_info(merchant_alias_source)`)
    .all() as { name: string }[];
  const aliasSourceColNames = new Set(aliasSourceCols.map((c) => c.name));
  if (!aliasSourceColNames.has("normalizedStem")) {
    db.exec(`ALTER TABLE merchant_alias_source ADD COLUMN normalizedStem TEXT NOT NULL DEFAULT ''`);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_merchant_alias_source_stem
       ON merchant_alias_source(normalizedStem, source)`,
    );
    const rows = db
      .prepare(`SELECT sourcePattern, source FROM merchant_alias_source`)
      .all() as { sourcePattern: string; source: string }[];
    if (rows.length > 0) {
      const updateStmt = db.prepare(
        `UPDATE merchant_alias_source SET normalizedStem = ? WHERE sourcePattern = ? AND source = ?`,
      );
      const txn = db.transaction(() => {
        for (const r of rows) {
          updateStmt.run(normalizeMerchantStem(r.sourcePattern), r.sourcePattern, r.source);
        }
      });
      txn();
    }
  }

  // merchant_alias_reject: migrate v1 single-stem rejection model (which
  // over-suppressed both sides of any rejected pair) to v2 pair-keyed model.
  // Detected by presence of the old `sourcePattern` column. Drop + recreate
  // is acceptable here because v1 rejects can't be safely translated to v2
  // pairs (a single-side reject had no partner stem to pair with).
  const rejectCols = db.prepare(`PRAGMA table_info(merchant_alias_reject)`).all() as { name: string }[];
  const rejectColNames = new Set(rejectCols.map((c) => c.name));
  if (rejectColNames.has("sourcePattern") && !rejectColNames.has("rocketStem")) {
    db.exec(`DROP TABLE merchant_alias_reject`);
    db.exec(`
      CREATE TABLE merchant_alias_reject (
        rocketStem  TEXT NOT NULL,
        plaidStem   TEXT NOT NULL,
        rocketLabel TEXT NOT NULL,
        plaidLabel  TEXT NOT NULL,
        rejectedAt  TEXT NOT NULL,
        PRIMARY KEY (rocketStem, plaidStem)
      )
    `);
  }

  const accountCols = db.prepare(`PRAGMA table_info(accounts)`).all() as { name: string }[];
  const accountColNames = new Set(accountCols.map((c) => c.name));
  if (!accountColNames.has("profileId")) {
    db.exec(`ALTER TABLE accounts ADD COLUMN profileId TEXT`);
  }
  if (!accountColNames.has("accountGroup")) {
    db.exec(`ALTER TABLE accounts ADD COLUMN accountGroup TEXT`);
    // Best-effort backfill from the local accountType string. Retirement
    // can't be detected from accountType alone (no subtype) — the user can
    // reclassify retirement rows manually on /settings/accounts. Then layer
    // on a refinement using the latest known plaidSubtype from balance
    // snapshots, when available, to catch retirement subtypes automatically.
    db.exec(`
      UPDATE accounts SET accountGroup = CASE
        WHEN lower(accountType) IN ('credit card', 'credit') THEN 'credit_cards'
        WHEN lower(accountType) = 'loan' THEN 'loans'
        WHEN lower(accountType) IN ('cash', 'depository') THEN 'cash_checking'
        WHEN lower(accountType) = 'investment' THEN 'investment'
        ELSE 'other'
      END
      WHERE accountGroup IS NULL
    `);
    // Refine investment → retirement using the latest plaidSubtype from
    // balance snapshots. Only runs if the balance table exists yet (fresh
    // dbs skip; old dbs get the upgrade).
    const balExists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='plaid_account_balances'`)
      .get();
    if (balExists) {
      db.exec(`
        UPDATE accounts
        SET accountGroup = 'retirement'
        WHERE id IN (
          SELECT a.id FROM accounts a
          JOIN plaid_account_balances b ON b.accountId = a.id
          WHERE a.accountGroup = 'investment'
            AND lower(IFNULL(b.plaidSubtype, '')) IN (
              '401a','401k','403b','457b','529','ira','roth','roth 401k','roth ira',
              'pension','retirement','sep ira','simple ira','sarsep','keogh',
              'thrift savings plan','lif','lira','lrif','lrsp','prif','rdsp','resp',
              'rlif','rrif','rrsp','tfsa','sipp','isa','cash isa','stocks and shares isa'
            )
        )
      `);
    }
  }

  // One-time profile seed + backfill. Detect by "profiles table empty".
  // Idempotent: any subsequent startup with profiles present is a no-op.
  const profileCount = (db.prepare(`SELECT COUNT(*) AS n FROM profiles`).get() as { n: number }).n;
  if (profileCount === 0) {
    const now = new Date().toISOString();
    const seedProfile = db.prepare(
      `INSERT INTO profiles (id, displayName, color, ownerUserId, isShared, archived, createdAt)
       VALUES (?, ?, ?, ?, ?, 0, ?)`,
    );
    // Ships with a single default profile + user. Add more from the Profiles
    // settings page to silo spending (e.g. personal vs. shared-household).
    // (Only runs on a fresh DB; an existing multi-profile DB is untouched.)
    seedProfile.run(DEFAULT_PROFILE_ID, "Household", "#0ea5e9", null, 1, now);

    const seedUser = db.prepare(
      `INSERT OR IGNORE INTO users (id, displayName, createdAt) VALUES (?, ?, ?)`,
    );
    seedUser.run(DEFAULT_USER_ID, "Me", now);

    const seedAccess = db.prepare(
      `INSERT OR IGNORE INTO profile_access (userId, profileId) VALUES (?, ?)`,
    );
    seedAccess.run(DEFAULT_USER_ID, DEFAULT_PROFILE_ID);
  }

  // One-shot migration: rename userOverrides.ignored → userOverrides.excluded in transactions.
  // Gated by absence of the migration marker row in the meta table.
  const migrationDone = db
    .prepare(`SELECT 1 FROM meta WHERE key = 'migration_excluded_rename_v1'`)
    .get();
  if (!migrationDone) {
    // Rewrite every transaction that has ignored=true or ignored=false set
    db.exec(`
      UPDATE transactions
      SET userOverrides = json_set(
        json_remove(userOverrides, '$.ignored'),
        '$.excluded',
        json_extract(userOverrides, '$.ignored')
      )
      WHERE json_extract(userOverrides, '$.ignored') IS NOT NULL
    `);
    // Rewrite rule actions: {type:"ignore"} → {type:"exclude"}
    const allRules = db.prepare(`SELECT id, actions FROM rules`).all() as { id: string; actions: string }[];
    const updateRule = db.prepare(`UPDATE rules SET actions = ? WHERE id = ?`);
    for (const rule of allRules) {
      try {
        const actions = JSON.parse(rule.actions);
        const updated = actions.map((a: { type: string; value?: string }) =>
          a.type === "ignore" ? { ...a, type: "exclude" } : a
        );
        updateRule.run(JSON.stringify(updated), rule.id);
      } catch {
        // malformed rule JSON — skip
      }
    }
    db.prepare(`INSERT INTO meta (key, value) VALUES ('migration_excluded_rename_v1', '1')`).run();
  }

  // One-shot: any category string that exists in transactions but has no
  // matching row in `categories` represents a category the user deleted before
  // tombstones existed. Tombstone the name and clear it from transactions so it
  // doesn't keep surfacing in dropdowns. Gated by migration marker so it only
  // runs once — after this point, all category deletions go through
  // deleteCategory() which creates tombstones properly. Previously this ran on
  // every startup and would destroy categories inserted by external tools
  // (e.g. seed scripts) before the backfill below could create rows for them.
  const orphanCleanupDone = db
    .prepare(`SELECT 1 FROM meta WHERE key = 'migration_orphan_category_cleanup_v1'`)
    .get();
  if (!orphanCleanupDone) {
    db.exec(`
      INSERT OR IGNORE INTO deleted_categories (displayName, deletedAt)
      SELECT DISTINCT t.category, datetime('now')
      FROM transactions t
      LEFT JOIN categories c ON c.displayName = t.category
      WHERE t.category != '' AND c.displayName IS NULL
    `);
    db.exec(`
      UPDATE transactions
      SET category = ''
      WHERE category IN (SELECT displayName FROM deleted_categories)
    `);
    db.prepare(`INSERT INTO meta (key, value) VALUES ('migration_orphan_category_cleanup_v1', '1')`).run();
  }

  // Backfill: create category rows for any categories in transactions that
  // don't have a row yet AND aren't tombstoned. Safe to run every startup.
  // Smart-classifies each NEW category by name (income/ignored/expense);
  // INSERT OR IGNORE means existing user classifications are never touched.
  backfillCategoryRows(db);

  // plaid_account_balances: append-only balance snapshots from /accounts/get.
  // One row per (plaidAccountId, asOf) — asOf is the ISO timestamp of the sync.
  // Used to drive the Net Worth panel on /dashboard and eventually a balance-over-time chart.
  const balTables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='plaid_account_balances'`).get();
  if (!balTables) {
    db.exec(`
      CREATE TABLE plaid_account_balances (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        plaidAccountId  TEXT NOT NULL REFERENCES plaid_accounts(plaidAccountId) ON DELETE CASCADE,
        accountId       TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        asOf            TEXT NOT NULL,
        current         REAL,
        available       REAL,
        creditLimit     REAL,
        isoCurrencyCode TEXT,
        plaidType       TEXT,
        plaidSubtype    TEXT,
        createdAt       TEXT NOT NULL
      );
      CREATE INDEX idx_plaid_account_balances_account
        ON plaid_account_balances(plaidAccountId, asOf DESC);
    `);
  }

  instance = db;
  return db;
}

export function closeDb(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}
