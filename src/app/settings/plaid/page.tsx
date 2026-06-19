import { getDb } from "@/lib/db.ts";
import { FEATURES } from "@/lib/appMode.ts";
import { makePlaidItemRepo } from "@/lib/repo/plaidItemRepo.ts";
import { makePlaidStagingRepo } from "@/lib/repo/plaidStagingRepo.ts";
import { makePlaidStagingRemovalsRepo } from "@/lib/repo/plaidStagingRemovalsRepo.ts";
import { makeAccountRepo } from "@/lib/repo/accountRepo.ts";
import { formatAccountLabel } from "@/lib/format.ts";
import { BanksClient, type BankItemView, type LocalAccountOption } from "./BanksClient.tsx";

export const dynamic = "force-dynamic";

export default async function BanksSettingsPage() {
  const db = getDb();
  const plaidRepo = makePlaidItemRepo(db);
  const stagingRepo = makePlaidStagingRepo(db);
  const removalsRepo = makePlaidStagingRemovalsRepo(db);
  const accountRepo = makeAccountRepo(db);
  const items = plaidRepo.list();
  const accounts = accountRepo.list();
  const stagedCounts = stagingRepo.countsByItem();
  const removalCounts = removalsRepo.countsByItem();
  const referenceCounts = stagingRepo.referenceCountsByItem();
  const earliestPlaidDates = plaidRepo.earliestPlaidDateByItem();

  const itemsWithAccounts: BankItemView[] = items.map((item) => {
    const links = plaidRepo.accountLinksByItem(item.itemId);
    return {
      itemId: item.itemId,
      institutionName: item.institutionName,
      lastSyncedAt: item.lastSyncedAt,
      createdAt: item.createdAt,
      stagedCount: stagedCounts.get(item.itemId) ?? 0,
      removalCount: removalCounts.get(item.itemId) ?? 0,
      referenceCount: referenceCounts.get(item.itemId) ?? 0,
      earliestPlaidDate: earliestPlaidDates.get(item.itemId) ?? null,
      linkedAccounts: links.map((l) => {
        const acct = accounts.find((a) => a.id === l.accountId);
        return {
          plaidAccountId: l.plaidAccountId,
          accountId: l.accountId,
          label: acct
            ? `${acct.institutionName} · ${formatAccountLabel(acct)}`
            : "(missing local account)",
        };
      }),
    };
  });

  const localAccountOptions: LocalAccountOption[] = accounts
    .filter((a) => !a.archived)
    .map((a) => ({
      id: a.id,
      label: `${a.institutionName} · ${formatAccountLabel(a)}`,
      institutionName: a.institutionName,
      accountNumberLast4: a.accountNumberLast4,
    }));

  return (
    <main style={{ padding: "2rem", maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ fontSize: "1.625rem", margin: "0.5rem 0 1rem" }}>Connected Banks</h1>
      <p style={{ opacity: 0.7, fontSize: "1.025rem", marginBottom: "1.5rem" }}>
        Connect a bank via Plaid to pull transactions automatically.
        {FEATURES.csvImport && " CSV import still works alongside this for any institution Plaid doesn’t cover."}
      </p>
      <BanksClient items={itemsWithAccounts} localAccounts={localAccountOptions} />
    </main>
  );
}
