import { getDb } from "../../lib/db.ts";
import { makeTransactionRepo, type TransactionFilters } from "../../lib/repo/transactionRepo.ts";
import { makeAccountRepo } from "../../lib/repo/accountRepo.ts";
import { makeTagRepo } from "../../lib/repo/tagRepo.ts";
import { makeCategoryRepo } from "../../lib/repo/categoryRepo.ts";
import { makeRuleRepo } from "../../lib/repo/ruleRepo.ts";
import { computeMerchantIndex } from "../../lib/aggregations.ts";
import { makeRefundMatchRepo } from "../../lib/repo/refundMatchRepo.ts";
import { applyNetting } from "../../lib/refundNetting.ts";
import { resolveProfileFilter, accessibleProfiles } from "../../lib/auth.ts";
import { formatAccountLabel } from "../../lib/format.ts";
import MerchantsClient, { type MerchantSortKey, type NumericFilterState } from "./MerchantsClient.tsx";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ [k: string]: string | string[] | undefined }>;

function firstValue(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

function csvList(v: string | string[] | undefined): string[] {
  const s = firstValue(v);
  if (!s) return [];
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

const VALID_SORTS: MerchantSortKey[] = ["net", "count", "avg", "lastSeen", "name", "topCategory"];

export type NumericOp = "gt" | "gte" | "lt" | "lte" | "eq";
const VALID_OPS: NumericOp[] = ["gt", "gte", "lt", "lte", "eq"];

function parseNumericOp(raw: string | undefined): NumericOp | null {
  return VALID_OPS.includes(raw as NumericOp) ? (raw as NumericOp) : null;
}

function parseNumericVal(raw: string | undefined): number | null {
  if (raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function applyNumericOp(value: number, op: NumericOp, target: number): boolean {
  switch (op) {
    case "gt": return value > target;
    case "gte": return value >= target;
    case "lt": return value < target;
    case "lte": return value <= target;
    case "eq": return value === target;
  }
}

export default async function MerchantsIndexPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;

  const rawSort = firstValue(sp.sort);
  const sort: MerchantSortKey = VALID_SORTS.includes(rawSort as MerchantSortKey)
    ? (rawSort as MerchantSortKey)
    : "net";
  // Default direction per column: "net" defaults to asc (most-negative = biggest spend first);
  // every other column defaults to desc.
  const rawDir = firstValue(sp.dir);
  const dir: "asc" | "desc" =
    rawDir === "asc" || rawDir === "desc" ? rawDir : sort === "net" ? "asc" : "desc";

  const profileParam = firstValue(sp.profile);
  const profileIds = resolveProfileFilter(profileParam);

  const rawExcluded = firstValue(sp.excluded);
  const excludedFilter = rawExcluded === "hide" || rawExcluded === "only" ? rawExcluded : "all";
  const rawOneTime = firstValue(sp.oneTime);
  const oneTimeFilter = rawOneTime === "hide" || rawOneTime === "only" ? rawOneTime : "all";
  const rawCanonical = firstValue(sp.canonical);
  const canonicalFilter = rawCanonical === "missing" || rawCanonical === "present" ? rawCanonical : "all";
  const rawSource = firstValue(sp.source);
  const sourceFilter: "csv" | "plaid" | "manual" | undefined =
    rawSource === "csv" || rawSource === "plaid" || rawSource === "manual" ? rawSource : undefined;

  const filters: TransactionFilters = {
    tagIds: csvList(sp.tags),
    accountIds: csvList(sp.accounts),
    categories: csvList(sp.categories),
    from: firstValue(sp.from),
    to: firstValue(sp.to),
    profileIds: profileIds ?? undefined,
    excludedFilter,
    oneTimeFilter,
    canonicalFilter,
    source: sourceFilter,
  };

  const db = getDb();
  const txRepo = makeTransactionRepo(db);
  const rawTransactions = txRepo.query(filters);
  // Net refunds before aggregation so "Net Amount" reflects net, not gross.
  const { transactions: allTransactions } = applyNetting(rawTransactions, txRepo, makeRefundMatchRepo(db), "date-window");

  const categoryObjects = makeCategoryRepo(db).list();
  const categoryMap = new Map(categoryObjects.map((c) => [c.displayName, c]));
  const accountRepo = makeAccountRepo(db);
  const accounts = accountRepo.list();
  const accountTagMap = accountRepo.tagMap();
  const rules = makeRuleRepo(db).list().filter((r) => r.enabled);
  const tags = makeTagRepo(db).list();

  const availableCategoryNames = Array.from(
    new Set([...categoryObjects.map((c) => c.displayName), ...txRepo.distinctCategories()]),
  ).sort((a, b) => a.localeCompare(b));
  const categoryMeta: {
    name: string;
    icon: string | null;
    color: string | null;
    classification: "expense" | "income" | "ignored" | null;
  }[] = availableCategoryNames.map((name) => {
    const c = categoryMap.get(name);
    const cls = c?.classification;
    return {
      name,
      icon: c?.icon ?? null,
      color: c?.color ?? null,
      classification:
        cls === "expense" || cls === "income" || cls === "ignored" ? cls : null,
    };
  });

  const merchantItems = computeMerchantIndex(allTransactions, rules, categoryMap, accountTagMap, {
    excludeOneTime: false,
  });

  const q = (firstValue(sp.q) ?? "").trim().toLowerCase();
  const txnsOp = parseNumericOp(firstValue(sp.txnsOp));
  const txnsVal = parseNumericVal(firstValue(sp.txnsVal));
  const netOp = parseNumericOp(firstValue(sp.netOp));
  const netVal = parseNumericVal(firstValue(sp.netVal));

  const filtered = merchantItems.filter((m) => {
    if (q && !m.merchant.toLowerCase().includes(q)) return false;
    if (txnsOp && txnsVal !== null && !applyNumericOp(m.count, txnsOp, txnsVal)) return false;
    if (netOp && netVal !== null && !applyNumericOp(m.net, netOp, netVal)) return false;
    return true;
  });

  // Sort server-side so pagination is stable.
  const sortMul = dir === "asc" ? 1 : -1;
  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    switch (sort) {
      case "count":
        cmp = a.count - b.count;
        break;
      case "avg":
        cmp = a.avgPerMonth - b.avgPerMonth;
        break;
      case "lastSeen":
        cmp = (a.lastSeen ?? "").localeCompare(b.lastSeen ?? "");
        break;
      case "name":
        cmp = a.merchant.localeCompare(b.merchant);
        break;
      case "topCategory":
        cmp = (a.topCategory ?? "").localeCompare(b.topCategory ?? "");
        break;
      case "net":
      default:
        cmp = a.net - b.net;
    }
    if (cmp === 0) cmp = a.merchant.localeCompare(b.merchant);
    return cmp * sortMul;
  });

  const PAGE_SIZE = 50;
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const rawPage = Number.parseInt(firstValue(sp.page) ?? "1", 10);
  const page = Number.isFinite(rawPage) ? Math.min(Math.max(1, rawPage), totalPages) : 1;
  const pageStart = (page - 1) * PAGE_SIZE;
  const pageItems = sorted.slice(pageStart, pageStart + PAGE_SIZE);

  const accountInfos = accounts.map((a) => ({
    id: a.id,
    accountName: a.accountName,
    customName: a.customName ?? null,
    institutionName: a.institutionName,
    accountNumberLast4: a.accountNumberLast4,
    tags: a.tags,
  }));
  const profileOptions = accessibleProfiles().map((p) => ({ id: p.id, displayName: p.displayName, color: p.color }));

  return (
    <MerchantsClient
      items={pageItems}
      totalCount={sorted.length}
      page={page}
      pageSize={PAGE_SIZE}
      totalPages={totalPages}
      sort={sort}
      dir={dir}
      from={filters.from ?? null}
      to={filters.to ?? null}
      profileIds={profileIds}
      numericFilters={{
        txnsOp,
        txnsVal: txnsVal,
        netOp,
        netVal: netVal,
      } satisfies NumericFilterState}
      accounts={accounts.map((a) => ({ id: a.id, label: formatAccountLabel(a) }))}
      tags={tags.map((t) => ({ id: t.id, displayName: t.displayName }))}
      categoryMeta={categoryMeta}
      availableCategoryNames={availableCategoryNames}
      accountInfos={accountInfos}
      profileOptions={profileOptions}
    />
  );
}
