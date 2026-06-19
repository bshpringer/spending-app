import { getDb } from "../../../lib/db.ts";
import { makeTransactionRepo } from "../../../lib/repo/transactionRepo.ts";
import { makeRuleRepo } from "../../../lib/repo/ruleRepo.ts";
import { makeCategoryRepo } from "../../../lib/repo/categoryRepo.ts";
import { makeAccountRepo } from "../../../lib/repo/accountRepo.ts";
import { makeTagRepo } from "../../../lib/repo/tagRepo.ts";
import {
  computePeriodTotals,
  computeCategoryBreakdownForPeriod,
  computeTagBreakdownForPeriod,
  computeOneTimeByPeriod,
} from "../../../lib/aggregations.ts";
import {
  periodKeyFor,
  prevPeriod,
  formatPeriodLabel,
  periodStartDate,
  periodEndDate,
  comparisonClipDate,
  periodIsInProgress,
} from "../../../lib/period.ts";
import type { Granularity } from "../../../lib/period.ts";
import DashboardClient from "../DashboardClient.tsx";
import { resolveProfileFilter, accessibleProfiles } from "../../../lib/auth.ts";

const VALID_GRANULARITIES = new Set(["week", "month", "quarter", "year"]);

function currentPeriodKey(g: Granularity): string {
  const d = new Date();
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return periodKeyFor(iso, g);
}

function queryWindowStart(g: Granularity): string {
  const d = new Date();
  switch (g) {
    case "week": d.setMonth(d.getMonth() - 14); break;
    case "month": d.setMonth(d.getMonth() - 25); break;
    case "quarter": d.setFullYear(d.getFullYear() - 6); break;
    case "year": d.setFullYear(d.getFullYear() - 10); break;
  }
  return d.toISOString().slice(0, 10);
}

function slicePeriods<T>(totals: T[], g: Granularity): T[] {
  switch (g) {
    case "month": return totals.slice(0, 24);
    case "week": return totals.slice(0, 52);
    default: return totals;
  }
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export default async function DashboardIncomePage({
  searchParams,
}: {
  searchParams: Promise<{
    period?: string;
    month?: string;
    granularity?: string;
    tagIds?: string;
    accountIds?: string;
    profile?: string;
    includeOneTime?: string;
    apples?: string;
  }>;
}) {
  const params = await searchParams;

  const granularity: Granularity = VALID_GRANULARITIES.has(params.granularity ?? "")
    ? (params.granularity as Granularity)
    : "month";

  const selectedPeriod = params.period ?? params.month ?? currentPeriodKey(granularity);
  const compPeriod = prevPeriod(selectedPeriod, granularity);

  const tagIds = params.tagIds ? params.tagIds.split(",").filter(Boolean) : [];
  const accountIds = params.accountIds ? params.accountIds.split(",").filter(Boolean) : [];
  const profileIds = resolveProfileFilter(params.profile);
  const excludeOneTime = params.includeOneTime !== "1";

  const isInProgress = periodIsInProgress(selectedPeriod, granularity);
  const applesParam = params.apples;
  const apples = applesParam !== undefined ? applesParam === "1" : isInProgress;

  const db = getDb();

  const transactions = makeTransactionRepo(db).query({
    tagIds: tagIds.length ? tagIds : undefined,
    accountIds: accountIds.length ? accountIds : undefined,
    profileIds: profileIds ?? undefined,
    from: queryWindowStart(granularity),
  });

  const rules = makeRuleRepo(db).list().filter((r) => r.enabled);
  const categoryMap = new Map(makeCategoryRepo(db).list().map((c) => [c.displayName, c]));
  const accountRepo = makeAccountRepo(db);
  const accountTagMap = accountRepo.tagMap();
  const accountInfos = accountRepo.list().map((a) => ({
    id: a.id,
    accountName: a.accountName,
    customName: a.customName ?? null,
    institutionName: a.institutionName,
    accountNumberLast4: a.accountNumberLast4,
    tags: a.tags,
  }));
  const profileOptions = accessibleProfiles().map((p) => ({ id: p.id, displayName: p.displayName, color: p.color }));

  const periodTotals = slicePeriods(
    computePeriodTotals(transactions, granularity, rules, categoryMap, accountTagMap, { excludeOneTime }),
    granularity,
  );
  const oneTimeByPeriodMap = computeOneTimeByPeriod(transactions, granularity, rules, categoryMap, accountTagMap);
  const oneTimeByPeriod = Object.fromEntries(oneTimeByPeriodMap);

  const categoryBreakdown = computeCategoryBreakdownForPeriod(
    transactions, selectedPeriod, granularity, rules, categoryMap, accountTagMap, "income", { excludeOneTime },
  );

  let comparisonTransactions = transactions;
  if (apples && isInProgress) {
    const now = new Date();
    const clipDateISO = comparisonClipDate(selectedPeriod, compPeriod, granularity, now);
    const compStart = periodStartDate(compPeriod, granularity);
    const compStartISO = `${compStart.getFullYear()}-${pad2(compStart.getMonth() + 1)}-${pad2(compStart.getDate())}`;
    comparisonTransactions = transactions.filter((tx) => {
      const aggDate = tx.originalDate || tx.date;
      if (periodKeyFor(aggDate, granularity) !== compPeriod) return true;
      return aggDate >= compStartISO && aggDate <= clipDateISO;
    });
  }

  const comparisonBreakdown = computeCategoryBreakdownForPeriod(
    comparisonTransactions, compPeriod, granularity, rules, categoryMap, accountTagMap, "income", { excludeOneTime },
  );

  const tagBreakdown = computeTagBreakdownForPeriod(
    transactions, selectedPeriod, granularity, rules, categoryMap, accountTagMap, { excludeOneTime },
  );

  const availableTags = makeTagRepo(db).list().map((t) => ({ id: t.id, displayName: t.displayName }));
  const availableCategories = makeTransactionRepo(db).distinctCategories();

  const selectedPeriodData = periodTotals.find((p) => p.period === selectedPeriod) ?? {
    period: selectedPeriod,
    income: 0,
    spend: 0,
  };

  const pStart = periodStartDate(selectedPeriod, granularity);
  const pEnd = periodEndDate(selectedPeriod, granularity);
  const periodFrom = `${pStart.getFullYear()}-${pad2(pStart.getMonth() + 1)}-${pad2(pStart.getDate())}`;
  const periodTo = `${pEnd.getFullYear()}-${pad2(pEnd.getMonth() + 1)}-${pad2(pEnd.getDate())}`;

  const cStart = periodStartDate(compPeriod, granularity);
  const cEnd = periodEndDate(compPeriod, granularity);
  const comparisonPeriodFrom = `${cStart.getFullYear()}-${pad2(cStart.getMonth() + 1)}-${pad2(cStart.getDate())}`;
  let comparisonPeriodTo = `${cEnd.getFullYear()}-${pad2(cEnd.getMonth() + 1)}-${pad2(cEnd.getDate())}`;
  if (apples && isInProgress) {
    comparisonPeriodTo = comparisonClipDate(selectedPeriod, compPeriod, granularity, new Date());
  }

  return (
    <DashboardClient
      view="income"
      granularity={granularity}
      periodTotals={periodTotals}
      categoryBreakdown={categoryBreakdown}
      comparisonBreakdown={comparisonBreakdown}
      tagBreakdown={tagBreakdown}
      merchantBreakdown={[]}
      selectedPeriod={selectedPeriod}
      selectedPeriodLabel={formatPeriodLabel(selectedPeriod, granularity)}
      comparisonPeriodLabel={formatPeriodLabel(compPeriod, granularity)}
      selectedPeriodData={selectedPeriodData}
      activeTagIds={tagIds}
      activeAccountIds={accountIds}
      availableTags={availableTags}
      availableCategories={availableCategories}
      profileParam={params.profile}
      profileIds={profileIds}
      accountInfos={accountInfos}
      profileOptions={profileOptions}
      excludeOneTime={excludeOneTime}
      oneTimeByPeriod={oneTimeByPeriod}
      periodFrom={periodFrom}
      periodTo={periodTo}
      comparisonPeriodFrom={comparisonPeriodFrom}
      comparisonPeriodTo={comparisonPeriodTo}
      apples={apples}
      showApplesToggle={isInProgress}
    />
  );
}
