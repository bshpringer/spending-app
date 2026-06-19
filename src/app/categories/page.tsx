import React from "react";
import { getDb } from "../../lib/db.ts";
import { makeCategoryRepo } from "../../lib/repo/categoryRepo.ts";
import { makeTagRepo } from "../../lib/repo/tagRepo.ts";
import { makeTransactionRepo } from "../../lib/repo/transactionRepo.ts";
import { makeRuleRepo } from "../../lib/repo/ruleRepo.ts";
import { makeAccountRepo } from "../../lib/repo/accountRepo.ts";
import { resolveRange } from "../../lib/categoryDateRange.ts";
import { computeCategoryIndexTotals } from "../../lib/aggregations.ts";
import { makeRefundMatchRepo } from "../../lib/repo/refundMatchRepo.ts";
import { applyNetting } from "../../lib/refundNetting.ts";
import CategoriesClient, { type CategoryItem, type SortKey } from "./CategoriesClient.tsx";
import { resolveProfileFilter, accessibleProfiles } from "../../lib/auth.ts";

const SORT_KEYS: SortKey[] = ["spend", "count", "name"];

function parseSort(raw: string | undefined): SortKey {
  return SORT_KEYS.includes(raw as SortKey) ? (raw as SortKey) : "spend";
}

type SearchParams = Promise<{ range?: string; from?: string; to?: string; sort?: string; profile?: string }>;

export default async function CategoriesPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const resolved = resolveRange(sp);
  const sortKey = parseSort(sp.sort);
  const profileIds = resolveProfileFilter(sp.profile);

  const db = getDb();
  const txRepo = makeTransactionRepo(db);
  const categories = makeCategoryRepo(db).list();
  const availableTags = makeTagRepo(db).list().map((t) => ({ id: t.id, displayName: t.displayName }));
  const availableCategories = txRepo.distinctCategories();

  const rawTransactions = txRepo.query({
    from: resolved.from ?? undefined,
    to: resolved.to ?? undefined,
    profileIds: profileIds ?? undefined,
  });
  // Net refunds before aggregation so per-category totals reflect net spend.
  const { transactions } = applyNetting(rawTransactions, txRepo, makeRefundMatchRepo(db), "date-window");
  const rules = makeRuleRepo(db).list().filter((r) => r.enabled);
  const categoryMap = new Map(categories.map((c) => [c.displayName, c]));
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

  const totals = computeCategoryIndexTotals(transactions, rules, categoryMap, accountTagMap);

  const items: CategoryItem[] = categories.map((cat) => {
    const agg = totals.get(cat.displayName);
    return {
      category: cat,
      count: agg?.count ?? 0,
      expense: agg?.expense ?? 0,
      income: agg?.income ?? 0,
    };
  });

  return (
    <React.Suspense fallback={<div>Loading categories...</div>}>
      <CategoriesClient
        items={items}
        from={resolved.from ?? null}
        to={resolved.to ?? null}
        preset={resolved.preset}
        sortKey={sortKey}
        availableTags={availableTags}
        availableCategories={availableCategories}
        profileIds={profileIds}
        accountInfos={accountInfos}
        profileOptions={profileOptions}
      />
    </React.Suspense>
  );
}
