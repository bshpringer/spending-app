import Link from "next/link";
import { getDb } from "@/lib/db";
import { makeCategoryRepo } from "@/lib/repo/categoryRepo";
import { makeTransactionRepo } from "@/lib/repo/transactionRepo";
import { makeAccountRepo } from "@/lib/repo/accountRepo";
import { makeTagRepo } from "@/lib/repo/tagRepo";
import { makeRefundMatchRepo } from "@/lib/repo/refundMatchRepo";
import { makePrefsRepo } from "@/lib/repo/prefsRepo.ts";
import { applyNetting, buildLinkedRefundRows } from "@/lib/refundNetting";
import { MerchantTransactionSection } from "./MerchantTransactionSection.tsx";
import { TransactionFiltersBar } from "../../transactions/TransactionFilters.tsx";
import { formatMoney, formatAccountLabel } from "@/lib/format";
import { accessibleProfiles } from "@/lib/auth";
import { parseTransactionFilters, firstValue } from "@/lib/transactionFilterParams.ts";
import { bucketByGranularity, parseDetailGranularity } from "@/lib/detailChart.ts";

export const dynamic = "force-dynamic";

type Params = Promise<{ name: string }>;
type SearchParams = Promise<{ [k: string]: string | string[] | undefined }>;

export default async function MerchantDetailPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { name } = await params;
  const sp = await searchParams;
  const merchant = decodeURIComponent(name);

  const db = getDb();
  const txRepo = makeTransactionRepo(db);

  const prefs = makePrefsRepo(db).getAll();
  const defaultExcluded: "all" | "hide" = prefs.hideExcludedByDefault ? "hide" : "all";

  // Parse the standard transaction filter params, then FORCE the merchant. The
  // category filter IS kept here (a merchant can span categories). Everything
  // below derives from this single filtered query.
  const { filters } = parseTransactionFilters(sp, { defaultExcluded });
  const scopedFilters = { ...filters, merchant, sort: "date" as const, dir: "desc" as const };

  const rawTransactions = txRepo.query(scopedFilters);
  const { transactions: allTransactions, allPairs } = applyNetting(rawTransactions, txRepo, makeRefundMatchRepo(db), "scoped");

  const accounts = makeAccountRepo(db).list();
  const tags = makeTagRepo(db).list();
  const categoryObjects = makeCategoryRepo(db).list();
  const categoryMap = new Map(categoryObjects.map((c) => [c.displayName, c]));
  const allCategories = Array.from(new Set([
    ...categoryObjects.map((c) => c.displayName),
    ...txRepo.distinctCategories(),
  ])).sort((a, b) => a.localeCompare(b));

  // Category chips for the filter bar — only the categories this merchant
  // actually spans (respecting the other active filters, but not `categories`
  // itself or `search`), mirroring /transactions' context-aware chip logic.
  const categoryNamesInContext = txRepo.distinctCategoriesMatching({
    ...scopedFilters,
    search: undefined,
    categories: undefined,
  });
  const categoryMeta: {
    name: string;
    icon: string | null;
    color: string | null;
    classification: "expense" | "income" | "ignored" | null;
  }[] = categoryNamesInContext.map((catName) => {
    const c = categoryMap.get(catName);
    const cls = c?.classification;
    return {
      name: catName,
      icon: c?.icon ?? null,
      color: c?.color ?? null,
      classification:
        cls === "expense" || cls === "income" || cls === "ignored" ? cls : null,
    };
  });

  // Note: an empty filtered set is no longer a hard 404 — filters can
  // legitimately empty it, so we always render the page chrome (header, filter
  // bar) so the user can adjust.
  const expenses = allTransactions.filter((t) => t.amount < 0);
  const income = allTransactions.filter((t) => t.amount > 0);
  const totalSpent = expenses.reduce((s, t) => s + t.amount, 0); // negative
  const totalIncome = income.reduce((s, t) => s + t.amount, 0);
  const netAmount = totalIncome + totalSpent;
  const avgAmount = expenses.length > 0 ? Math.abs(totalSpent) / expenses.length : 0;

  const dates = allTransactions.map((t) => t.originalDate || t.date).sort();
  const firstDate = dates[0];
  const lastDate = dates[dates.length - 1];

  // Categories used by this merchant in the filtered set (compact strip).
  const catCounts = new Map<string, number>();
  for (const t of allTransactions) {
    const c = t.category || "Uncategorized";
    catCounts.set(c, (catCounts.get(c) ?? 0) + 1);
  }
  const topCategories = [...catCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  const isIncomeMerchant = netAmount > 0;

  // Chart buckets at the chosen granularity — over the date-picker window set.
  // The whole window set is sent to the client; clicking a bar isolates the
  // table to that bucket purely client-side (no server round-trip).
  const granularity = parseDetailGranularity(firstValue(sp.chartG));
  const chartData = bucketByGranularity(
    allTransactions.map((t) => ({ dateISO: t.originalDate || t.date, value: isIncomeMerchant ? t.amount : -t.amount })),
    granularity,
  );

  // Earliest / latest aggregation date across the filtered set — All-Time subline.
  let dataMinDate: string | null = null;
  let dataMaxDate: string | null = null;
  for (const t of allTransactions) {
    const d = t.originalDate || t.date;
    if (!d) continue;
    if (dataMinDate === null || d < dataMinDate) dataMinDate = d;
    if (dataMaxDate === null || d > dataMaxDate) dataMaxDate = d;
  }

  const suppressedRefundIds = new Set(allPairs.map((p) => p.refundId));
  const txRows = allTransactions
    .filter((t) => !suppressedRefundIds.has(t.id))
    .map((t) => ({
      id: t.id,
      date: t.originalDate || t.date,
      name: t.name,
      customName: t.customName,
      canonicalName: t.canonicalName,
      category: t.category,
      amount: t.amount,
      note: t.note,
      tags: t.tags,
      excluded: t.userOverrides.excluded === true,
      oneTime: t.userOverrides.oneTime === true,
      accountId: t.accountId,
      profileId: t.profileId,
    }));

  const linkedRefunds = buildLinkedRefundRows(
    new Set(txRows.map((r) => r.id)),
    allPairs,
    txRepo,
  );
  const profileOptions = accessibleProfiles().map((p) => ({ id: p.id, displayName: p.displayName, color: p.color }));

  const accountInfos = accounts.map((a) => ({
    id: a.id,
    accountName: a.accountName,
    customName: a.customName ?? null,
    institutionName: a.institutionName,
    accountNumberLast4: a.accountNumberLast4,
    tags: a.tags,
  }));

  const isMostlyExpense = expenses.length >= income.length;
  const chartColor = isMostlyExpense ? "#6366f1" : "#16a34a";
  const chartLabel = isMostlyExpense ? "Spent" : "Income";

  return (
    <main style={{ padding: "2rem", maxWidth: 1100, margin: "0 auto" }}>
      <Link
        href="/merchants"
        style={{ fontSize: "0.975rem", opacity: 0.6, textDecoration: "none", display: "inline-block", marginBottom: "1.25rem" }}
      >
        ← Merchants
      </Link>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem" }}>
        <h1 data-sensitive style={{ fontSize: "1.625rem", fontWeight: 700, margin: 0 }}>{merchant}</h1>
        <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "#888", border: "1px solid #ddd", borderRadius: 4, padding: "0.15rem 0.5rem" }}>
          Merchant
        </span>
      </div>

      {/* Stats row — reflects the active filters */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem 2rem", fontSize: "0.975rem", opacity: 0.75, marginBottom: "0.75rem" }}>
        <span>{allTransactions.length} transaction{allTransactions.length !== 1 ? "s" : ""}</span>
        {expenses.length > 0 && (
          <span style={{ color: "#a00" }}>Total spent: <span data-sensitive>{formatMoney(Math.abs(totalSpent))}</span></span>
        )}
        {expenses.length > 0 && (
          <span>Avg: <span data-sensitive>{formatMoney(avgAmount)}</span></span>
        )}
        {income.length > 0 && (
          <span style={{ color: "#070" }}>Total received: <span data-sensitive>{formatMoney(totalIncome)}</span></span>
        )}
        {expenses.length > 0 && income.length > 0 && (
          <span style={{ color: netAmount < 0 ? "#a00" : "#070" }}>Net: <span data-sensitive>{formatMoney(netAmount)}</span></span>
        )}
        {firstDate && <span style={{ opacity: 0.7 }}>{firstDate} → {lastDate}</span>}
      </div>

      {/* Compact categories strip — chips link to category detail pages */}
      {topCategories.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem 0.6rem", alignItems: "baseline", marginBottom: "1.5rem", fontSize: "0.9rem" }}>
          <span style={{ fontSize: "0.8rem", fontWeight: 700, letterSpacing: "0.06em", color: "#999", textTransform: "uppercase", marginRight: "0.25rem" }}>
            Categories
          </span>
          {topCategories.map(([category, count]) => (
            <Link
              key={category}
              href={`/categories/${encodeURIComponent(category)}`}
              title={`${category} · ${count} txn${count !== 1 ? "s" : ""}`}
              style={{
                display: "inline-flex",
                alignItems: "baseline",
                gap: "0.35rem",
                padding: "0.15rem 0.55rem",
                borderRadius: 999,
                border: "1px solid #e3e3e3",
                background: "#fafafa",
                color: "inherit",
                textDecoration: "none",
                whiteSpace: "nowrap",
              }}
            >
              <span style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }}>{category}</span>
              <span style={{ opacity: 0.5, fontSize: "0.825rem" }}>×{count}</span>
            </Link>
          ))}
        </div>
      )}

      {/* Full transactions-style filter bar — keeps the category section. */}
      <TransactionFiltersBar
        accounts={accounts.map((a) => ({
          id: a.id,
          label: formatAccountLabel(a),
          profileId: a.profileId,
          accountGroup: a.accountGroup,
        }))}
        profiles={profileOptions}
        tags={tags.map((t) => ({ id: t.id, displayName: t.displayName }))}
        categories={categoryMeta}
        searchPlaceholder="Search category, note…"
        dataMinDate={dataMinDate}
        dataMaxDate={dataMaxDate}
        defaultExcluded={defaultExcluded}
      />

      {/* Chart + transaction list (client component) */}
      <MerchantTransactionSection
        transactions={txRows}
        accounts={accountInfos}
        chartData={chartData}
        granularity={granularity}
        chartColor={chartColor}
        chartLabel={chartLabel}
        availableTags={tags.map((t) => ({ id: t.id, displayName: t.displayName }))}
        availableCategories={allCategories}
        profiles={profileOptions}
        linkedRefunds={linkedRefunds}
        emptyMessage="No transactions match the current filters."
      />
    </main>
  );
}
