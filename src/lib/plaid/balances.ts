import type { Database } from "better-sqlite3";
import { getPlaidClient } from "./client.ts";
import { makePlaidItemRepo } from "../repo/plaidItemRepo.ts";
import { makePlaidBalanceRepo, type BalanceInput } from "../repo/plaidBalanceRepo.ts";

/**
 * Fetch current balances for all linked accounts under a single Plaid item
 * and write a snapshot row for each one. Called from the balances-sync route
 * and opportunistically from the transactions sync route.
 *
 * Returns the number of snapshots written.
 */
export async function snapshotItemBalances(db: Database, itemId: string): Promise<number> {
  const itemRepo = makePlaidItemRepo(db);
  const balanceRepo = makePlaidBalanceRepo(db);

  const accessToken = itemRepo.getAccessToken(itemId);
  if (!accessToken) return 0;

  const links = itemRepo.accountLinksByItem(itemId);
  if (links.length === 0) return 0;

  const accountIdByPlaidId = new Map(links.map((l) => [l.plaidAccountId, l.accountId]));

  const client = getPlaidClient();
  const resp = await client.accountsGet({ access_token: accessToken });

  const asOf = new Date().toISOString();
  const rows: BalanceInput[] = [];

  for (const acct of resp.data.accounts) {
    const accountId = accountIdByPlaidId.get(acct.account_id);
    if (!accountId) continue; // not reconciled — skip

    rows.push({
      plaidAccountId: acct.account_id,
      accountId,
      asOf,
      current: acct.balances.current ?? null,
      available: acct.balances.available ?? null,
      creditLimit: acct.balances.limit ?? null,
      isoCurrencyCode: acct.balances.iso_currency_code ?? null,
      plaidType: acct.type ? String(acct.type) : null,
      plaidSubtype: acct.subtype ? String(acct.subtype) : null,
    });
  }

  if (rows.length > 0) balanceRepo.insertBatch(rows);
  return rows.length;
}
