import { getDb } from "../../lib/db.ts";
import { makeTransactionRepo } from "../../lib/repo/transactionRepo.ts";
import { makeRuleRepo } from "../../lib/repo/ruleRepo.ts";
import { makeCategoryRepo } from "../../lib/repo/categoryRepo.ts";
import { makeAccountRepo } from "../../lib/repo/accountRepo.ts";
import { makeRecurringDismissalRepo } from "../../lib/repo/recurringDismissalRepo.ts";
import { detectRecurring } from "../../lib/recurring.ts";
import { resolveProfileFilter } from "../../lib/auth.ts";
import RecurringClient from "./RecurringClient.tsx";

export const dynamic = "force-dynamic";

function lookbackDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

type SearchParams = Promise<{
  profile?: string;
  status?: string;
  cadence?: string;
  variance?: string;
  sort?: string;
  q?: string;
  showDismissed?: string;
  minOccurrences?: string;
}>;

export default async function RecurringPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const profileIds = resolveProfileFilter(sp.profile);
  const minOccurrences = Math.max(2, Number(sp.minOccurrences ?? 2) || 2);

  const db = getDb();
  const transactions = makeTransactionRepo(db).query({
    from: lookbackDate(730),
    profileIds: profileIds ?? undefined,
  });
  const rules = makeRuleRepo(db).list().filter((r) => r.enabled);
  const categoryMap = new Map(makeCategoryRepo(db).list().map((c) => [c.displayName, c]));
  const accountTagMap = makeAccountRepo(db).tagMap();
  const dismissed = new Set(makeRecurringDismissalRepo(db).listMerchants());

  const groups = detectRecurring(transactions, rules, categoryMap, accountTagMap, dismissed, {
    minOccurrences,
  });

  return (
    <RecurringClient
      groups={groups}
      profileParam={sp.profile}
      initialStatus={sp.status ?? "active"}
      initialCadence={sp.cadence ?? ""}
      initialVariance={sp.variance ?? "all"}
      initialSort={sp.sort ?? "monthly"}
      initialQuery={sp.q ?? ""}
      initialShowDismissed={sp.showDismissed === "1"}
      minOccurrences={minOccurrences}
    />
  );
}
