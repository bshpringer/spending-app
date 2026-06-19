import { getDb } from "../../lib/db.ts";
import { makeTransactionRepo } from "../../lib/repo/transactionRepo.ts";
import { makeRuleRepo } from "../../lib/repo/ruleRepo.ts";
import { makeCategoryRepo } from "../../lib/repo/categoryRepo.ts";
import { makeAccountRepo } from "../../lib/repo/accountRepo.ts";
import { makeRefundMatchRepo } from "../../lib/repo/refundMatchRepo.ts";
import { detectRefunds } from "../../lib/refunds.ts";
import { resolveProfileFilter } from "../../lib/auth.ts";
import { formatAccountLabel } from "../../lib/format.ts";
import type { Transaction } from "../../lib/types.ts";
import RefundsClient, { type ListedPair } from "./RefundsClient.tsx";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  profile?: string;
  tab?: string;
}>;

export default async function RefundsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const profileIds = resolveProfileFilter(sp.profile);

  const db = getDb();
  const txRepo = makeTransactionRepo(db);
  const matchRepo = makeRefundMatchRepo(db);

  // No date bound — if a refund/charge pair exists anywhere in history, we
  // want to surface it. Personal-scale dataset, detectRefunds is O(n×m) per
  // account so the cost is negligible.
  const transactions = txRepo.query({
    profileIds: profileIds ?? undefined,
  });
  const rules = makeRuleRepo(db).list().filter((r) => r.enabled);
  const categoryMap = new Map(makeCategoryRepo(db).list().map((c) => [c.displayName, c]));
  const accounts = makeAccountRepo(db).list();
  const accountTagMap = makeAccountRepo(db).tagMap();
  const accountLabelMap = new Map<string, string>(
    accounts.map((a) => [a.id, formatAccountLabel(a)]),
  );

  const confirmedPairs = matchRepo.confirmedPairKeys();
  const rejectedPairs = matchRepo.rejectedPairKeys();

  const suggestions = detectRefunds(
    transactions,
    rules,
    categoryMap,
    accountTagMap,
    confirmedPairs,
    rejectedPairs,
  );

  // For confirmed + rejected: hydrate Transaction objects by id. These rows
  // may reference transactions outside the 730-day query window, so look up
  // each one directly. Numbers are small in practice (single-user app).
  function hydrate(rows: ReturnType<typeof matchRepo.listByStatus>): ListedPair[] {
    const out: ListedPair[] = [];
    for (const row of rows) {
      const expense = txRepo.getById(row.expenseId);
      const refund = txRepo.getById(row.refundId);
      if (!expense || !refund) continue;
      // Respect profile filter on confirmed/rejected too.
      if (profileIds && !profileIds.includes(expense.profileId) && !profileIds.includes(refund.profileId)) continue;
      out.push({ expense, refund, createdAt: row.createdAt });
    }
    return out;
  }

  const confirmedPairsList = hydrate(matchRepo.listByStatus("confirmed"));
  const rejectedPairsList = hydrate(matchRepo.listByStatus("rejected"));

  const accountLabel = (tx: Transaction) =>
    tx.accountId ? accountLabelMap.get(tx.accountId) ?? "" : "(manual)";

  const initialTab = sp.tab === "confirmed" || sp.tab === "rejected" ? sp.tab : "suggested";

  return (
    <RefundsClient
      suggestions={suggestions.map((s) => ({
        expense: s.expense,
        refund: s.refund,
        confidence: s.confidence,
        reason: s.reason,
        expenseAccountLabel: accountLabel(s.expense),
        refundAccountLabel: accountLabel(s.refund),
      }))}
      confirmed={confirmedPairsList.map((p) => ({
        ...p,
        expenseAccountLabel: accountLabel(p.expense),
        refundAccountLabel: accountLabel(p.refund),
      }))}
      rejected={rejectedPairsList.map((p) => ({
        ...p,
        expenseAccountLabel: accountLabel(p.expense),
        refundAccountLabel: accountLabel(p.refund),
      }))}
      profileParam={sp.profile}
      initialTab={initialTab}
    />
  );
}
