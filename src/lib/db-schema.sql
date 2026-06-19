-- Budgeting app schema. Idempotent: safe to run on every startup.
-- Sign convention reminder: transactions.amount uses standard accounting
-- (negative = expense, positive = income). Rocket Money CSV is flipped on import.

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  accountName TEXT NOT NULL,
  customName TEXT,
  accountNumberLast4 TEXT NOT NULL,
  institutionName TEXT NOT NULL,
  accountType TEXT NOT NULL,
  accountGroup TEXT,
  profileId TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  naturalKey TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS account_tags (
  accountId TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  tagId TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (accountId, tagId)
);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  displayName TEXT NOT NULL,
  color TEXT,
  description TEXT,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  dedupeKey TEXT NOT NULL UNIQUE,
  accountId TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  originalDate TEXT NOT NULL,
  name TEXT NOT NULL,
  customName TEXT,
  canonicalName TEXT,
  amount REAL NOT NULL,
  csvAmount REAL NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  ignoredFrom TEXT NOT NULL DEFAULT '',
  taxDeductible INTEGER NOT NULL DEFAULT 0,
  userOverrides TEXT NOT NULL DEFAULT '{}',
  importedFromCsvAt TEXT NOT NULL,
  importBatchId TEXT,
  source TEXT NOT NULL DEFAULT 'csv',
  plaidTransactionId TEXT,
  plaidRaw TEXT,
  -- Verbatim Plaid payload JSON. Existing DBs get this via the db.ts runtime
  -- migration; declared here too so fresh DBs (and test DBs built from this
  -- file alone) have it from day one.
  plaidRawFull TEXT,
  profileId TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transactions_accountId ON transactions(accountId);
CREATE INDEX IF NOT EXISTS idx_transactions_profileId ON transactions(profileId);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_plaid
  ON transactions(plaidTransactionId)
  WHERE plaidTransactionId IS NOT NULL;
-- Indexes on plaidRaw JSON fields are created in db.ts after the column
-- is guaranteed to exist via ALTER TABLE, otherwise db.exec(schema) crashes
-- on existing databases where the column doesn't exist yet.
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category);
CREATE INDEX IF NOT EXISTS idx_transactions_importBatchId ON transactions(importBatchId);

CREATE TABLE IF NOT EXISTS transaction_tags (
  transactionId TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  tagId TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (transactionId, tagId)
);

CREATE INDEX IF NOT EXISTS idx_transaction_tags_tagId ON transaction_tags(tagId);

-- Category metadata. displayName is the natural key (matches transactions.category string).
-- classification: 'expense' | 'income' | 'ignored' (extensible string, not enum).
-- 'ignored' means excluded from all totals and breakdown charts.
CREATE TABLE IF NOT EXISTS categories (
  displayName TEXT PRIMARY KEY,
  classification TEXT NOT NULL DEFAULT 'expense',
  color TEXT,
  icon TEXT,
  createdAt TEXT NOT NULL
);

-- Tombstones: category names the user explicitly deleted. Keeps them out of
-- dropdowns, prevents the importer from re-creating them on re-import, and
-- causes incoming transactions in tombstoned categories to land as Uncategorized.
CREATE TABLE IF NOT EXISTS deleted_categories (
  displayName TEXT PRIMARY KEY,
  deletedAt TEXT NOT NULL
);

-- Transaction rules. Conditions and actions stored as JSON arrays.
-- priority: lower number = higher priority (evaluated in ascending order).
CREATE TABLE IF NOT EXISTS rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 0,
  conditions TEXT NOT NULL DEFAULT '[]',
  actions TEXT NOT NULL DEFAULT '[]',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rules_priority ON rules(priority);

-- Profiles. A profile is exactly-one-per-transaction (unlike tags). Inherited
-- from the transaction's account by default; can be overridden per-transaction.
-- Profile is the primary "whose money is this" classifier. Tags remain for
-- cross-cutting concerns (big-purchases, vacation-2026, etc).
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  displayName TEXT NOT NULL,
  color TEXT,
  ownerUserId TEXT,
  isShared INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL
);

-- Users. Single-user today (stub row inserted by migration). When the app
-- gains real auth, this is where authenticated users land.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  displayName TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

-- Many-to-many: which users can see which profiles. The single chokepoint
-- in lib/auth.ts reads from this to decide what the current user can access.
CREATE TABLE IF NOT EXISTS profile_access (
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profileId TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  PRIMARY KEY (userId, profileId)
);

-- Per-merchant dismissals from the /recurring view. Global (not profile-scoped):
-- the user explicitly chose simplicity here. Merchant key = trimmed customName ?? name.
CREATE TABLE IF NOT EXISTS recurring_dismissals (
  merchant TEXT PRIMARY KEY,
  dismissedAt TEXT NOT NULL
);

-- Per-cluster dismissals from the merchant triage page (reconcile-merchants).
-- Keyed by normalized merchant stem (normalizeMerchantStem). `label` is a
-- human-readable raw name kept so the "Ignored" list stays legible even if the
-- underlying transactions are later deleted.
CREATE TABLE IF NOT EXISTS merchant_triage_dismissals (
  stem TEXT PRIMARY KEY,
  label TEXT NOT NULL DEFAULT '',
  dismissedAt TEXT NOT NULL
);

-- Persisted user decisions about dedupe-key collision groups.
-- Keyed on the BASE dedupeKey (pre-#N suffix) so a decision sticks across re-imports.
CREATE TABLE IF NOT EXISTS collision_decisions (
  baseDedupeKey TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('legit', 'possible_duplicate')),
  note TEXT,
  decidedAt TEXT NOT NULL
);

-- Generic key/value store for migration markers and app-level flags.
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- User decisions about refund ↔ original-charge pairs. Only confirmed and
-- rejected pairs are persisted; "suggested" is recomputed fresh per page load
-- by detectRefunds() and filtered against the rejected set. ON DELETE CASCADE
-- means hard-deleting either side cleans up the link row automatically.
CREATE TABLE IF NOT EXISTS refund_matches (
  expenseId TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  refundId  TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  status    TEXT NOT NULL CHECK (status IN ('confirmed','rejected')),
  createdAt TEXT NOT NULL,
  PRIMARY KEY (expenseId, refundId)
);
CREATE INDEX IF NOT EXISTS idx_refund_matches_expense ON refund_matches(expenseId);
CREATE INDEX IF NOT EXISTS idx_refund_matches_refund  ON refund_matches(refundId);

-- User decisions about post-import duplicate-looking transaction pairs.
-- "kept" = user reviewed and decided both rows are real and distinct (don't
-- suggest again). Hard-deleting either side just drops the row via the FK
-- cascade — suggested-but-not-yet-decided pairs are recomputed fresh per page
-- load by detectDuplicates(). Pair ordering: txAId < txBId (lex order) so each
-- unordered pair has exactly one canonical key.
CREATE TABLE IF NOT EXISTS duplicate_reviews (
  txAId     TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  txBId     TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  status    TEXT NOT NULL CHECK (status IN ('kept')),
  createdAt TEXT NOT NULL,
  PRIMARY KEY (txAId, txBId)
);
CREATE INDEX IF NOT EXISTS idx_duplicate_reviews_a ON duplicate_reviews(txAId);
CREATE INDEX IF NOT EXISTS idx_duplicate_reviews_b ON duplicate_reviews(txBId);

-- User decisions about cross-source (Rocket/CSV ↔ Plaid) reconciliation pairs,
-- powering the /reconcile page. A matched Plaid row enriches the CSV row in
-- place and is NEVER inserted as its own transaction, so only the CSV side is a
-- real transactions.id (FK, cascade-cleaned on delete); the Plaid side is stored
-- as the raw, re-pull-stable plaidTransactionId (NOT a FK — the row may never
-- exist in `transactions`). "reconciled" = user accepted the enrichment;
-- "rejected" = not the same charge, never suggest again. Both statuses suppress
-- the pair from future suggestions (detectReconciliations recomputes "suggested"
-- fresh per load and filters against the union, mirroring refund_matches).
CREATE TABLE IF NOT EXISTS reconciliation_reviews (
  csvTransactionId   TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  plaidTransactionId TEXT NOT NULL,
  status             TEXT NOT NULL CHECK (status IN ('reconciled','rejected')),
  createdAt          TEXT NOT NULL,
  PRIMARY KEY (csvTransactionId, plaidTransactionId)
);
CREATE INDEX IF NOT EXISTS idx_reconciliation_reviews_csv   ON reconciliation_reviews(csvTransactionId);
CREATE INDEX IF NOT EXISTS idx_reconciliation_reviews_plaid ON reconciliation_reviews(plaidTransactionId);

-- Plaid integration. One row per linked institution ("Item" in Plaid parlance).
-- accessToken is held locally only; never logged, never sent anywhere but plaid.com.
CREATE TABLE IF NOT EXISTS plaid_items (
  itemId          TEXT PRIMARY KEY,
  accessToken     TEXT NOT NULL,
  institutionId   TEXT,
  institutionName TEXT,
  cursor          TEXT,
  lastSyncedAt    TEXT,
  createdAt       TEXT NOT NULL,
  updatedAt       TEXT NOT NULL
);

-- Maps Plaid's per-bank account_id values onto our local accounts.id.
-- One row per Plaid sub-account; either created fresh (paired with a new accounts
-- row) or merged onto an existing accounts row at reconciliation time.
CREATE TABLE IF NOT EXISTS plaid_accounts (
  plaidAccountId TEXT PRIMARY KEY,
  itemId         TEXT NOT NULL REFERENCES plaid_items(itemId) ON DELETE CASCADE,
  accountId      TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  createdAt      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plaid_accounts_account ON plaid_accounts(accountId);
CREATE INDEX IF NOT EXISTS idx_plaid_accounts_item ON plaid_accounts(itemId);

-- Staging area for Plaid syncs. Mirrors the CSV review-before-commit flow:
-- /api/plaid/sync writes here, user reviews on /settings/banks/review/[itemId],
-- /api/plaid/commit-batch promotes to `transactions` and advances the cursor.
-- The Plaid cursor itself is NOT advanced when staging rows are written —
-- next_cursor is parked in plaid_items.pendingCursor and only swapped into
-- plaid_items.cursor on commit. This makes syncs replayable (discard a batch
-- and the next sync re-pulls the same window).
--
-- proposedAction:
--   'keep'  → insert into transactions on commit
--   'skip'  → drop on commit (user said "not a transaction I care about")
--   'merge' → don't insert; backfill plaidTransactionId onto the matched
--             existing transactions row so future syncs auto-dedupe.
CREATE TABLE IF NOT EXISTS plaid_staging (
  stagingId             TEXT PRIMARY KEY,
  itemId                TEXT NOT NULL REFERENCES plaid_items(itemId) ON DELETE CASCADE,
  plaidTransactionId    TEXT NOT NULL,
  accountId             TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  profileId             TEXT,
  dedupeKey             TEXT NOT NULL,
  date                  TEXT NOT NULL,
  originalDate          TEXT NOT NULL,
  name                  TEXT NOT NULL,
  customName            TEXT,
  amount                REAL NOT NULL,
  csvAmount             REAL NOT NULL,
  description           TEXT NOT NULL DEFAULT '',
  category              TEXT NOT NULL DEFAULT '',
  note                  TEXT NOT NULL DEFAULT '',
  tags                  TEXT NOT NULL DEFAULT '[]',  -- JSON array of tag display names
  proposedAction        TEXT NOT NULL DEFAULT 'keep' CHECK(proposedAction IN ('keep','skip','merge')),
  matchedTransactionId  TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  flagReason            TEXT,
  mode                  TEXT NOT NULL DEFAULT 'commit',
  canonicalName         TEXT,
  prefilledFromMediumAlias INTEGER NOT NULL DEFAULT 0,
  plaidRaw              TEXT,
  replacesTransactionId TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  inheritedOverrides    TEXT,
  createdAt             TEXT NOT NULL,
  updatedAt             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plaid_staging_item ON plaid_staging(itemId);
-- Scoped by (itemId, plaidTransactionId, mode): a Plaid transaction can be
-- staged simultaneously as a reference-pull row (mode='reference', for the
-- reconciliation wizard) AND a commit-mode row (mode='commit', pending review).
-- Earlier versions of this index omitted `mode` and the commit-mode insert
-- silently collided with existing reference rows, dropping all sync results.
CREATE UNIQUE INDEX IF NOT EXISTS idx_plaid_staging_plaid_txn
  ON plaid_staging(itemId, plaidTransactionId, mode);

-- Staging for Plaid removals (transactions Plaid says no longer exist —
-- typically a pending row that was replaced by a posted row with a new id).
-- Separate table from plaid_staging because the action space differs:
--   'delete' → DELETE the local row on commit
--   'ignore' → leave the local row alone (e.g. user already merged it via
--              the additions side of the batch and doesn't want it gone)
-- Only rows whose plaidTransactionId resolves to an existing local row are
-- staged; orphan removals (e.g. for txns that were never inserted) are dropped
-- silently by the sync route.
CREATE TABLE IF NOT EXISTS plaid_staging_removals (
  itemId                TEXT NOT NULL REFERENCES plaid_items(itemId) ON DELETE CASCADE,
  plaidTransactionId    TEXT NOT NULL,
  matchedTransactionId  TEXT NOT NULL,
  matchedDate           TEXT NOT NULL,
  matchedName           TEXT NOT NULL,
  matchedAmount         REAL NOT NULL,
  proposedAction        TEXT NOT NULL DEFAULT 'delete' CHECK(proposedAction IN ('delete','ignore')),
  replacementHint       TEXT,
  createdAt             TEXT NOT NULL,
  PRIMARY KEY (itemId, plaidTransactionId)
);
CREATE INDEX IF NOT EXISTS idx_plaid_staging_removals_item ON plaid_staging_removals(itemId);

-- ─── Phase 2: merchant reconciliation ───
-- canonicalName lives between raw name and customName in the display precedence:
-- customName ?? canonicalName ?? name. Populated by the reconciliation wizard
-- and the Plaid staging pre-fill hook; never touched by normal user edits.

-- A merchant alias = one canonical identity. The defaultCategory is consulted
-- when an incoming Plaid sync line maps to this canonical and the row has no
-- prior category — see /api/plaid/sync for the lookup. confidence is set by
-- the reconciliation algorithm and gates silent pre-fill ('high' silent;
-- 'medium' flags the staging row; 'low' never pre-fills).
CREATE TABLE IF NOT EXISTS merchant_alias (
  canonicalName   TEXT PRIMARY KEY,
  defaultCategory TEXT,
  confidence      TEXT NOT NULL DEFAULT 'high' CHECK(confidence IN ('high','medium','low')),
  createdAt       TEXT NOT NULL,
  updatedAt       TEXT NOT NULL
);

-- The patterns that resolve to a canonical alias. One row per (sourcePattern,
-- source) pair — same merchant can have a Rocket pattern AND a Plaid pattern
-- both pointing at the same canonical.
CREATE TABLE IF NOT EXISTS merchant_alias_source (
  sourcePattern   TEXT NOT NULL,
  source          TEXT NOT NULL CHECK(source IN ('rocket','plaid')),
  canonicalName   TEXT NOT NULL REFERENCES merchant_alias(canonicalName) ON DELETE CASCADE,
  matchType       TEXT NOT NULL DEFAULT 'exact' CHECK(matchType IN ('exact','prefix','regex')),
  normalizedStem  TEXT NOT NULL DEFAULT '',
  createdAt       TEXT NOT NULL,
  PRIMARY KEY (sourcePattern, source)
);
CREATE INDEX IF NOT EXISTS idx_merchant_alias_source_canonical
  ON merchant_alias_source(canonicalName);
-- NOTE: the (normalizedStem, source) index is created in the db.ts migration,
-- not here. On a fresh DB the schema SQL runs first and the column exists via
-- the CREATE TABLE; on an existing DB the table is left alone by IF NOT EXISTS
-- and the column doesn't appear until the ALTER TABLE in the migration runs.
-- Defining the index in the migration covers both cases idempotently.

-- Schema reserved for Phase 3 (account-aware category defaults). Unused in 2.0.
CREATE TABLE IF NOT EXISTS merchant_alias_account_override (
  canonicalName TEXT NOT NULL REFERENCES merchant_alias(canonicalName) ON DELETE CASCADE,
  accountId     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  category      TEXT NOT NULL,
  PRIMARY KEY (canonicalName, accountId)
);

-- Reconciliation wizard "do not re-surface" markers. Keyed on the (rocketStem,
-- plaidStem) PAIR so rejecting "Verizon × pet insurance" only suppresses that
-- exact pairing — both Verizon (Rocket) and pet insurance (Plaid) remain
-- eligible to match their real counterparts. The *Label columns store one
-- representative pattern from each side for UI display.
CREATE TABLE IF NOT EXISTS merchant_alias_reject (
  rocketStem  TEXT NOT NULL,
  plaidStem   TEXT NOT NULL,
  rocketLabel TEXT NOT NULL,
  plaidLabel  TEXT NOT NULL,
  rejectedAt  TEXT NOT NULL,
  PRIMARY KEY (rocketStem, plaidStem)
);
