// User-facing categorization of accounts for Net Worth grouping. Distinct from
// Plaid's `type`/`subtype` (which we still store as-is) — this is a single
// editable bucket per local account that drives the Dashboard's grouped view
// and the per-group include/exclude toggles. Codes (not display strings) are
// stored on accounts.accountGroup so labels can change without a data migration.

export type AccountGroup =
  | "cash_checking"
  | "credit_cards"
  | "investment"
  | "retirement"
  | "loans"
  | "other";

export const ACCOUNT_GROUPS: AccountGroup[] = [
  "cash_checking",
  "credit_cards",
  "investment",
  "retirement",
  "loans",
  "other",
];

export const ACCOUNT_GROUP_LABELS: Record<AccountGroup, string> = {
  cash_checking: "Cash & Checking",
  credit_cards: "Credit Cards",
  investment: "Investment",
  retirement: "Retirement",
  loans: "Loans",
  other: "Other",
};

// Whether a group sums into assets (true) or liabilities (false) for the Net
// Worth headline. Credit cards and loans are negative; everything else is
// asset-side. (Retirement is still an asset — the include/exclude toggle is a
// separate concern, handled in NetWorthClient.)
export const ACCOUNT_GROUP_IS_LIABILITY: Record<AccountGroup, boolean> = {
  cash_checking: false,
  credit_cards: true,
  investment: false,
  retirement: false,
  loans: true,
  other: false,
};

// Groups excluded from the "liquid net worth" headline by default. The user
// can flip these in the dashboard UI; preferences are stored in localStorage.
// Rationale: retirement accounts are usually penalty-locked and shouldn't
// count toward "what I can spend right now." Loans are excluded by default
// only because most users want to see "what could I liquidate" — they can
// add them back in if they want a full balance-sheet view.
export const DEFAULT_LIQUID_EXCLUDED: AccountGroup[] = ["retirement"];

// Plaid subtype strings that indicate a retirement account. Source: Plaid's
// account-subtype reference. Conservatively lowercase + normalized. Anything
// not in this list defaults to taxable Investment when the type is `investment`.
const RETIREMENT_SUBTYPES = new Set<string>([
  "401a",
  "401k",
  "403b",
  "457b",
  "529",
  "ira",
  "roth",
  "roth 401k",
  "roth ira",
  "pension",
  "retirement",
  "sep ira",
  "simple ira",
  "sarsep",
  "keogh",
  "thrift savings plan",
  "lif",
  "lira",
  "lrif",
  "lrsp",
  "prif",
  "rdsp",
  "resp",
  "rlif",
  "rrif",
  "rrsp",
  "tfsa",
  "sipp",
  "isa",
  "cash isa",
  "stocks and shares isa",
]);

/**
 * Default group assignment from Plaid's `type` (+ optional `subtype`). Used at
 * reconcile time when a new local account is created from a Plaid sub-account.
 * Existing user-edited groups are NEVER overwritten — this only fires on first
 * account creation.
 */
export function defaultGroupFromPlaid(
  plaidType: string | null | undefined,
  plaidSubtype: string | null | undefined,
): AccountGroup {
  const type = (plaidType ?? "").trim().toLowerCase();
  const subtype = (plaidSubtype ?? "").trim().toLowerCase();
  if (type === "credit") return "credit_cards";
  if (type === "loan") return "loans";
  if (type === "depository") return "cash_checking";
  if (type === "investment") {
    if (RETIREMENT_SUBTYPES.has(subtype)) return "retirement";
    return "investment";
  }
  return "other";
}

/**
 * Default group assignment from the local `accounts.accountType` string we use
 * elsewhere ("Credit Card" / "Cash" / "Investment" / "Loan" / etc.). Used by
 * the one-shot DB migration that backfills pre-existing rows where Plaid
 * subtype is unknown. Always returns the coarse bucket; the user can edit any
 * retirement-class rows manually from /settings/accounts.
 */
export function defaultGroupFromAccountType(accountType: string | null | undefined): AccountGroup {
  const t = (accountType ?? "").trim().toLowerCase();
  if (t === "credit card" || t === "credit") return "credit_cards";
  if (t === "loan") return "loans";
  if (t === "cash" || t === "depository") return "cash_checking";
  if (t === "investment") return "investment";
  return "other";
}

export function isAccountGroup(value: unknown): value is AccountGroup {
  return typeof value === "string" && (ACCOUNT_GROUPS as string[]).includes(value);
}
