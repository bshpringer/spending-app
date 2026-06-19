import type { Database } from "better-sqlite3";

export interface PlaidBalanceSnapshot {
  id: number;
  plaidAccountId: string;
  accountId: string;
  asOf: string;
  current: number | null;
  available: number | null;
  creditLimit: number | null;
  isoCurrencyCode: string | null;
  plaidType: string | null;
  plaidSubtype: string | null;
  createdAt: string;
}

export interface LatestAccountBalance {
  plaidAccountId: string;
  accountId: string;
  asOf: string;
  current: number | null;
  available: number | null;
  creditLimit: number | null;
  isoCurrencyCode: string | null;
  plaidType: string | null;
  plaidSubtype: string | null;
  // joined from accounts
  accountName: string;
  customName: string | null;
  institutionName: string;
  accountNumberLast4: string;
  accountType: string;
  accountGroup: string | null;
  profileId: string | null;
  // joined from plaid_items
  itemId: string;
  institutionDisplayName: string | null;
}

export interface BalanceInput {
  plaidAccountId: string;
  accountId: string;
  asOf: string;
  current: number | null;
  available: number | null;
  creditLimit: number | null;
  isoCurrencyCode: string | null;
  plaidType: string | null;
  plaidSubtype: string | null;
}

export function makePlaidBalanceRepo(db: Database) {
  const insert = db.prepare(`
    INSERT INTO plaid_account_balances
      (plaidAccountId, accountId, asOf, current, available, creditLimit, isoCurrencyCode, plaidType, plaidSubtype, createdAt)
    VALUES
      (@plaidAccountId, @accountId, @asOf, @current, @available, @creditLimit, @isoCurrencyCode, @plaidType, @plaidSubtype, @createdAt)
  `);

  const insertBatchFn = db.transaction((rows: BalanceInput[]) => {
    const now = new Date().toISOString();
    for (const row of rows) {
      insert.run({ ...row, createdAt: now });
    }
  });

  const LATEST_SELECT = `
    SELECT
      b.plaidAccountId,
      b.accountId,
      b.asOf,
      b.current,
      b.available,
      b.creditLimit,
      b.isoCurrencyCode,
      b.plaidType,
      b.plaidSubtype,
      a.accountName,
      a.customName,
      a.institutionName,
      a.accountNumberLast4,
      a.accountType,
      a.accountGroup,
      a.profileId,
      pa.itemId,
      pi.institutionName AS institutionDisplayName
    FROM plaid_account_balances b
    JOIN accounts a ON a.id = b.accountId
    JOIN plaid_accounts pa ON pa.plaidAccountId = b.plaidAccountId
    JOIN plaid_items pi ON pi.itemId = pa.itemId
    WHERE b.id = (
      SELECT id FROM plaid_account_balances b2
      WHERE b2.plaidAccountId = b.plaidAccountId
      ORDER BY b2.asOf DESC
      LIMIT 1
    )
  `;

  const latestAllStmt = db.prepare(
    `${LATEST_SELECT} ORDER BY pi.institutionName, a.accountName`,
  );

  const historyStmt = db.prepare(`
    SELECT asOf, current, available
    FROM plaid_account_balances
    WHERE plaidAccountId = ?
    ORDER BY asOf ASC
  `);

  // One row per (plaidAccountId, calendar date) — the LAST snapshot of each day
  // wins (matches the "append-only, last refresh-of-day wins" rule). Joins
  // accounts for profile filtering at the application layer.
  const historyDailyAllStmt = db.prepare(`
    SELECT b.plaidAccountId, date(b.asOf) AS day, b.current, a.profileId
    FROM plaid_account_balances b
    JOIN accounts a ON a.id = b.accountId
    WHERE b.asOf = (
      SELECT MAX(b2.asOf)
      FROM plaid_account_balances b2
      WHERE b2.plaidAccountId = b.plaidAccountId
        AND date(b2.asOf) = date(b.asOf)
    )
    ORDER BY day ASC, b.plaidAccountId ASC
  `);

  return {
    insertBatch(rows: BalanceInput[]): void {
      insertBatchFn(rows);
    },

    /**
     * Latest snapshot per linked account, optionally filtered to a set of profileIds.
     * Pass null/undefined for no profile filter (show all).
     */
    latestAll(profileIds?: string[] | null): LatestAccountBalance[] {
      const rows = latestAllStmt.all() as LatestAccountBalance[];
      if (!profileIds || profileIds.length === 0) return rows;
      const set = new Set(profileIds);
      return rows.filter((r) => r.profileId == null || set.has(r.profileId));
    },

    historyForAccount(plaidAccountId: string): { asOf: string; current: number | null; available: number | null }[] {
      return historyStmt.all(plaidAccountId) as { asOf: string; current: number | null; available: number | null }[];
    },

    /**
     * Daily balance history across all accounts — one row per (account, day)
     * using the last snapshot of each calendar day. Optionally narrowed by
     * profile (same semantics as latestAll: null profileId rows pass through).
     */
    historyDailyAll(profileIds?: string[] | null): { plaidAccountId: string; day: string; current: number | null }[] {
      const rows = historyDailyAllStmt.all() as { plaidAccountId: string; day: string; current: number | null; profileId: string | null }[];
      const filtered = (!profileIds || profileIds.length === 0)
        ? rows
        : rows.filter((r) => r.profileId == null || profileIds.includes(r.profileId));
      return filtered.map(({ plaidAccountId, day, current }) => ({ plaidAccountId, day, current }));
    },
  };
}

export type PlaidBalanceRepo = ReturnType<typeof makePlaidBalanceRepo>;
