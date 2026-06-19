import { getDb } from "../../lib/db.ts";
import { makeTransactionRepo } from "../../lib/repo/transactionRepo.ts";
import { makeAccountRepo } from "../../lib/repo/accountRepo.ts";
import { makeTagRepo } from "../../lib/repo/tagRepo.ts";
import { makePlaidItemRepo } from "../../lib/repo/plaidItemRepo.ts";
import { makeReconciliationReviewRepo } from "../../lib/repo/reconciliationReviewRepo.ts";
import { resolveProfileFilter } from "../../lib/auth.ts";
import { formatAccountLabel } from "../../lib/format.ts";
import ReconcileClient, {
  type ReconcileBankOption,
  type ReconcileReviewedRow,
} from "./ReconcileClient.tsx";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ profile?: string; tab?: string }>;

export default async function ReconcilePage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const profileIds = resolveProfileFilter(sp.profile);

  const db = getDb();
  const txRepo = makeTransactionRepo(db);
  const accountRepo = makeAccountRepo(db);
  const itemRepo = makePlaidItemRepo(db);
  const reviewRepo = makeReconciliationReviewRepo(db);

  const accounts = accountRepo.list();
  const accountLabels: Record<string, string> = Object.fromEntries(
    accounts.map((a) => [a.id, formatAccountLabel(a)]),
  );

  // Bank picker — one option per reconciled Plaid item. The earliest Plaid date
  // seeds the default "From" (where the overlap window can start).
  const earliestByItem = itemRepo.earliestPlaidDateByItem();
  const today = new Date().toISOString().slice(0, 10);
  const banks: ReconcileBankOption[] = itemRepo
    .list()
    .map((item) => {
      const links = itemRepo.accountLinksByItem(item.itemId);
      return {
        itemId: item.itemId,
        institutionName: item.institutionName ?? "(unknown bank)",
        accountLabels: links
          .map((l) => accountLabels[l.accountId])
          .filter((x): x is string => !!x),
        reconciled: links.length > 0,
        defaultFrom: earliestByItem.get(item.itemId) ?? "",
        defaultTo: today,
      };
    });

  // Reviewed tab — hydrate the surviving CSV row for each persisted decision.
  const reviewed: ReconcileReviewedRow[] = [];
  for (const row of reviewRepo.list()) {
    const csv = txRepo.getById(row.csvTransactionId);
    if (!csv) continue;
    if (profileIds && !profileIds.includes(csv.profileId)) continue;
    reviewed.push({
      csv,
      csvAccountLabel: csv.accountId ? accountLabels[csv.accountId] ?? "" : "(manual)",
      plaidTransactionId: row.plaidTransactionId,
      status: row.status,
      createdAt: row.createdAt,
    });
  }
  reviewed.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const availableTags = makeTagRepo(db).list().map((t) => ({ id: t.id, displayName: t.displayName }));
  const availableCategories = txRepo.distinctCategories();
  const initialTab = sp.tab === "reviewed" ? "reviewed" : sp.tab === "unmatched" ? "unmatched" : "unreviewed";

  return (
    <ReconcileClient
      banks={banks}
      reviewed={reviewed}
      profileParam={sp.profile}
      initialTab={initialTab}
      availableTags={availableTags}
      availableCategories={availableCategories}
      accountLabels={accountLabels}
    />
  );
}
