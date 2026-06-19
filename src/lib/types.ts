export type AccountType =
  | "Credit Card"
  | "Cash"
  | "Investment"
  | "Loan"
  | "Other";

export interface Account {
  id: string;
  accountName: string;
  customName?: string;
  accountNumberLast4: string;
  institutionName: string;
  accountType: AccountType | string;
  // User-editable bucket for Net Worth grouping. Stored as a code; see
  // accountGroups.ts for the canonical list. Nullable for legacy/manual
  // rows that predate the migration.
  accountGroup: import("./accountGroups.ts").AccountGroup | null;
  profileId: string;
  tags: string[];
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Profile {
  id: string;
  displayName: string;
  color?: string;
  ownerUserId?: string;
  isShared: boolean;
  archived: boolean;
  createdAt: string;
}

export interface User {
  id: string;
  displayName: string;
  createdAt: string;
}

/**
 * Curated subset of Plaid's full `Transaction` payload, stored as a JSON blob
 * on `transactions.plaidRaw` and `plaid_staging.plaidRaw`. Absent on CSV /
 * manual rows. Bumped versioning lives in the `version` field; the rest of
 * the app should tolerate any field being null (older rows, missing data
 * from Plaid).
 */
export interface TransactionPlaidRaw {
  version: 1;
  // Identity / lifecycle
  pending: boolean;
  pendingTransactionId: string | null; // points back to the pending row this replaces
  authorizedDate: string | null; // YYYY-MM-DD
  authorizedDatetime: string | null; // ISO-8601 to the second
  datetime: string | null; // posted datetime
  paymentChannel: string | null; // "online" | "in store" | "other"

  // Merchant identity
  merchantEntityId: string | null;
  counterpartyEntityIds: string[];
  logoUrl: string | null;
  website: string | null;

  // Disambiguation
  referenceNumber: string | null; // payment_meta.reference_number — best dedupe key for online merchants
  transactionCode: string | null;
  checkNumber: string | null;

  // Category extras (primary already lives in transactions.category)
  pfcDetailed: string | null;
  pfcConfidence: string | null;

  // Physical location (almost always null for online)
  location: {
    address: string | null;
    city: string | null;
    region: string | null;
    postalCode: string | null;
    country: string | null;
    storeNumber: string | null;
  } | null;
}

export interface TransactionUserOverrides {
  category?: string;
  customName?: string;
  tags?: string[];
  note?: string;
  excluded?: boolean;
  oneTime?: boolean;
}

export interface Transaction {
  id: string;
  dedupeKey: string;
  accountId: string | null;
  profileId: string;
  date: string;
  originalDate: string;
  name: string;
  customName?: string;
  canonicalName?: string;
  amount: number;
  csvAmount: number;
  description: string;
  category: string;
  note: string;
  ignoredFrom: string;
  taxDeductible: boolean;
  tags: string[];
  userOverrides: TransactionUserOverrides;
  importedFromCsvAt: string;
  importBatchId: string | null;
  source: string;
  plaidRaw: TransactionPlaidRaw | null;
  createdAt: string;
  updatedAt: string;
}

export interface Tag {
  id: string;
  displayName: string;
  color?: string;
  description?: string;
  createdAt: string;
}

export interface Category {
  displayName: string;
  classification: string; // 'expense' | 'income' | 'ignored' — extensible string
  color?: string;
  icon?: string;
  createdAt: string;
}

export interface ParsedAccount {
  accountName: string;
  accountNumberLast4: string;
  institutionName: string;
  accountType: string;
  accountGroup?: import("./accountGroups.ts").AccountGroup;
  naturalKey: string;
}

export interface ParsedTransaction {
  dedupeKey: string;
  accountNaturalKey: string;
  date: string;
  originalDate: string;
  name: string;
  amount: number;
  csvAmount: number;
  description: string;
  category: string;
  note: string;
  ignoredFrom: string;
  taxDeductible: boolean;
  tags: string[];
  // Set only for Plaid-sourced rows. Used as the primary dedupe key on insert
  // so re-syncs of the same Plaid transaction never duplicate.
  plaidTransactionId?: string;
  // Pre-filled by the Plaid staging alias lookup. Written through to
  // transactions.canonicalName on commit.
  canonicalName?: string | null;
  // Curated raw payload from Plaid for this row. Only set on Plaid-sourced
  // rows; surfaced to the pending→posted linker and the /duplicates UI.
  plaidRaw?: TransactionPlaidRaw | null;
  // Verbatim JSON.stringify of Plaid's full Transaction payload. Belt-and-
  // suspenders companion to `plaidRaw` so no field is ever permanently lost.
  // Only set on Plaid-sourced rows.
  plaidRawFull?: string | null;
}

export interface PlaidItem {
  itemId: string;
  institutionId: string | null;
  institutionName: string | null;
  cursor: string | null;
  pendingCursor: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PlaidStagingAction = "keep" | "skip" | "merge";
export type PlaidStagingRemovalAction = "delete" | "ignore";
export type PlaidStagingMode = "commit" | "reference";

export interface PlaidStagingRemovalRow {
  itemId: string;
  plaidTransactionId: string;
  matchedTransactionId: string;
  matchedDate: string;
  matchedName: string;
  matchedAmount: number;
  proposedAction: PlaidStagingRemovalAction;
  replacementHint: string | null;
  createdAt: string;
}

export interface PlaidStagingRow {
  stagingId: string;
  itemId: string;
  plaidTransactionId: string;
  accountId: string | null;
  profileId: string | null;
  dedupeKey: string;
  date: string;
  originalDate: string;
  name: string;
  customName: string | null;
  canonicalName: string | null;
  amount: number;
  csvAmount: number;
  description: string;
  category: string;
  note: string;
  tags: string[];
  proposedAction: PlaidStagingAction;
  matchedTransactionId: string | null;
  flagReason: string | null;
  mode: PlaidStagingMode;
  prefilledFromMediumAlias: boolean;
  plaidRaw: TransactionPlaidRaw | null;
  // Verbatim JSON of Plaid's full Transaction payload for this staged row.
  // Carried through to `transactions.plaidRawFull` on commit.
  plaidRawFull: string | null;
  // When non-null, this staging row is the posted version of an existing
  // committed transaction (the pending). On commit, the existing row is
  // hard-deleted and its user edits (overrides, customName, canonicalName,
  // note, tags) are inherited onto the inserted posted row. Set by the
  // pending→posted linker in /api/plaid/sync.
  replacesTransactionId: string | null;
  inheritedOverrides: TransactionUserOverrides | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlaidAccountLink {
  plaidAccountId: string;
  itemId: string;
  accountId: string;
  createdAt: string;
}

export interface DedupeCollision {
  dedupeKey: string;
  rows: ParsedTransaction[];
}

export interface CsvParseResult {
  transactions: ParsedTransaction[];
  accounts: ParsedAccount[];
  tagDisplayNames: string[];
  warnings: string[];
  collisions: DedupeCollision[];
}

export interface ImportSummary {
  newTransactions: number;
  matchedExisting: number;
  newAccounts: number;
  newTags: number;
  warnings: string[];
  importBatchId: string | null;
}

export interface AmbiguousCandidate {
  id: string;
  date: string;
  originalDate: string;
  name: string;
  customName: string | null;
  amount: number;
  description: string;
  category: string;
  note: string;
  dedupeKey: string;
}

export type ImportRowBucket = "new" | "duplicate" | "ambiguous";

export interface ClassifiedImportRow {
  parsed: ParsedTransaction;
  bucket: ImportRowBucket;
  // For "duplicate" — the existing row that matched on dedupeKey
  matchedExistingId?: string;
  // For "ambiguous" — existing rows with similar (account/amount/date/description) signals but different dedupeKey
  candidates?: AmbiguousCandidate[];
  // Reason(s) the row was flagged as ambiguous, surfaced to the user.
  ambiguousReasons?: string[];
  // Post-rule overlay applied to "new" rows so the preview reflects what will actually land
  ruleEffects?: RuleEffects;
  // Display label for the source account ("AmEx ··6789") — null if the account is new in this import.
  accountLabel: string | null;
  // The profileId the row will land under if the user doesn't override it. Inherited from the
  // account when the account exists; null when the account is brand-new (will default to the
  // creating user's profile on save).
  defaultProfileId: string | null;
}

export interface ImportClassification {
  rows: ClassifiedImportRow[];
  counts: {
    parsed: number;
    new: number;
    duplicate: number;
    ambiguous: number;
  };
  dateSpan: { from: string; to: string } | null;
  // Days in the file that already have at least one exact duplicate in DB.
  overlapDays: number;
  // Account natural keys present in the file that don't yet exist in DB.
  newAccountNaturalKeys: string[];
  // Existing category display names — powers the edit-row category picker.
  existingCategories: string[];
  // Existing tag display names — powers the edit-row tag suggestions.
  existingTags: string[];
  // Profiles the current user can write to. Used to populate per-row profile pickers.
  accessibleProfiles: Profile[];
  // Within-file dedupe-key collisions (multiple rows in the SAME CSV with identical
  // date|last4|amount|name|description). All persist via #N suffix; surfaced for review.
  collisions: DedupeCollision[];
  warnings: string[];
}

export interface ImportRowDecision {
  // Edited values applied as userOverrides on insert (also mirrored to columns)
  category?: string;
  customName?: string;
  note?: string;
  tags?: string[];
  excluded?: boolean;
  oneTime?: boolean;
  // Overrides the profileId that would otherwise be inherited from the account.
  profileId?: string;
}

export interface ImportDecisionsInput {
  // dedupeKeys (post-#N) of New rows the user wants to drop from this import
  skipNew?: string[];
  // dedupeKeys of Ambiguous rows the user has decided to KEEP (default: skip)
  keepAmbiguous?: string[];
  // dedupeKeys of Ambiguous rows to REPLACE: incoming dedupeKey → existing DB
  // row IDs to delete before inserting the replacement row.
  replaceAmbiguous?: Record<string, string[]>;
  // Per-row edits applied to inserted rows, keyed by dedupeKey
  overrides?: Record<string, ImportRowDecision>;
}

export interface MonthlyTotal {
  month: string; // YYYY-MM
  income: number;
  spend: number;
}

export interface PeriodTotal {
  period: string; // Key depends on granularity: YYYY-MM, YYYY-Qn, YYYY, YYYY-Www
  income: number;
  spend: number;
}

export interface CategoryTotal {
  category: string;
  total: number;
  count: number;
  color?: string;
  icon?: string;
}

export interface TagTotal {
  tag: string;
  total: number;
  count: number;
}

export interface MerchantTotal {
  merchant: string; // customName ?? name (post-rules)
  total: number;
  count: number;
}

export type ConditionField = "category" | "name" | "canonicalName" | "description" | "accountId" | "profileId" | "amount" | "tag";
export type ConditionOp = "eq" | "neq" | "contains" | "gt" | "lt" | "in";
export type ActionType =
  | "setCategory"
  | "setTags"
  | "addTag"
  | "removeTag"
  | "setCustomName"
  | "setCanonicalName"
  | "setProfile"
  | "exclude"
  | "markOneTime";

export interface RuleCondition {
  field: ConditionField;
  op: ConditionOp;
  value: string | number;
}

export interface RuleAction {
  type: ActionType;
  value?: string;
}

export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  conditions: RuleCondition[];
  actions: RuleAction[];
  createdAt: string;
  updatedAt: string;
}

export interface RuleEffects {
  exclude: boolean;
  oneTime: boolean;
  category?: string;
  customName?: string;
  canonicalName?: string;
  profileId?: string;
  /**
   * When defined, replaces the transaction's tag set entirely (before addTags /
   * removeTags apply). `[]` means "clear all tags". Undefined means no setTags
   * action ran, so the existing tag set is the base. Set by the `setTags` action.
   */
  setTags?: string[];
  addTags: string[];
  removeTags: string[];
}

// ─── Phase 2: merchant reconciliation ───

export type MerchantAliasSourceKind = "rocket" | "plaid";
export type MerchantAliasConfidence = "high" | "medium" | "low";
export type MerchantAliasMatchType = "exact" | "prefix" | "regex";

export interface MerchantAlias {
  canonicalName: string;
  defaultCategory: string | null;
  confidence: MerchantAliasConfidence;
  createdAt: string;
  updatedAt: string;
}

export interface MerchantAliasSource {
  sourcePattern: string;
  source: MerchantAliasSourceKind;
  canonicalName: string;
  matchType: MerchantAliasMatchType;
  createdAt: string;
}

export interface MerchantAliasReject {
  rocketStem: string;
  plaidStem: string;
  rocketLabel: string;
  plaidLabel: string;
  rejectedAt: string;
}

// One member of a reconcile candidate's cluster preview, for either source.
export interface ReconcilePreviewRow {
  date: string;
  rawName: string;
  amount: number;
  category: string;
  accountId: string | null;
}

// A proposed (Rocket pattern set, Plaid pattern set, canonicalName, category)
// tuple emitted by proposeCrossSourceMatches.
export interface ReconcileCandidate {
  id: string; // synthetic, stable across runs for skip-tracking
  proposedCanonicalName: string;
  proposedDefaultCategory: string | null;
  confidence: MerchantAliasConfidence;
  score: number;
  rocketPatterns: string[];
  plaidPatterns: string[];
  rocketPreview: ReconcilePreviewRow[];
  plaidPreview: ReconcilePreviewRow[];
  signals: string[]; // human-readable breakdown lines for the UI
  rocketTxnCount: number;
  plaidTxnCount: number;
}
