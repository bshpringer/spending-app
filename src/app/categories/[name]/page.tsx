import Link from "next/link";
import { getDb } from "@/lib/db";
import { makeCategoryRepo } from "@/lib/repo/categoryRepo";
import { makeTransactionRepo } from "@/lib/repo/transactionRepo";
import { makeAccountRepo } from "@/lib/repo/accountRepo";
import { makeTagRepo } from "@/lib/repo/tagRepo";
import { makeRefundMatchRepo } from "@/lib/repo/refundMatchRepo";
import { makePrefsRepo } from "@/lib/repo/prefsRepo.ts";
import { applyNetting, buildLinkedRefundRows } from "@/lib/refundNetting";
import { CategoryTransactionSection } from "./CategoryTransactionSection.tsx";
import { CategoryIconPicker } from "../CategoryIconPicker.tsx";
import { DeleteCategoryButton } from "./DeleteCategoryButton.tsx";
import { TransactionFiltersBar } from "../../transactions/TransactionFilters.tsx";
import { formatMoney, formatAccountLabel } from "@/lib/format";
import { accessibleProfiles } from "@/lib/auth";
import { parseTransactionFilters, firstValue } from "@/lib/transactionFilterParams.ts";
import { bucketByGranularity, parseDetailGranularity } from "@/lib/detailChart.ts";

export const dynamic = "force-dynamic";

type Params = Promise<{ name: string }>;
type SearchParams = Promise<{ [k: string]: string | string[] | undefined }>;

const CLASSIFICATION_LABELS: Record<string, string> = {
  income: "Income",
  expense: "Expense",
  ignored: "Ignored",
};

const CLASSIFICATION_COLORS: Record<string, string> = {
  income: "#16a34a",
  expense: "#374151",
  ignored: "#9ca3af",
};

const CHART_COLORS: Record<string, string> = {
  income: "#16a34a",
  expense: "#6366f1",
  ignored: "#9ca3af",
};

export default async function CategoryDetailPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { name } = await params;
  const sp = await searchParams;
  const categoryName = decodeURIComponent(name);

  const db = getDb();
  const category = makeCategoryRepo(db).get(categoryName);
  const txRepo = makeTransactionRepo(db);

  const prefs = makePrefsRepo(db).getAll();
  const defaultExcluded: "all" | "hide" = prefs.hideExcludedByDefault ? "hide" : "all";

  // Parse the standard transaction filter params, then FORCE the category — this
  // page is scoped to one category, so any incoming `categories` param is
  // ignored. Everything below (stats, chart, strip, table) derives from this
  // single filtered query, so it all moves together with the filter bar.
  const { filters } = parseTransactionFilters(sp, { defaultExcluded });
  const scopedFilters = { ...filters, categories: [categoryName], sort: "date" as const, dir: "desc" as const };

  const rawTransactions = txRepo.query(scopedFilters);
  const { transactions: allTransactions, allPairs } = applyNetting(rawTransactions, txRepo, makeRefundMatchRepo(db), "scoped");

  const accounts = makeAccountRepo(db).list();
  const tags = makeTagRepo(db).list();

  if (!category) {
    return (
      <main style={{ padding: "2rem", maxWidth: 900, margin: "0 auto" }}>
        <Link href="/categories" style={{ fontSize: "0.975rem", opacity: 0.6, textDecoration: "none" }}>
          ← Categories
        </Link>
        <p style={{ marginTop: "2rem", opacity: 0.6 }}>Category not found.</p>
      </main>
    );
  }

  const totalAmount = allTransactions.reduce((sum, t) => sum + t.amount, 0);
  const expenses = allTransactions.filter((t) => t.amount < 0);
  const income = allTransactions.filter((t) => t.amount > 0);
  const classLabel = CLASSIFICATION_LABELS[category.classification] ?? category.classification;
  const classColor = CLASSIFICATION_COLORS[category.classification] ?? "#374151";
  const chartColor = CHART_COLORS[category.classification] ?? "#6366f1";
  const isExpense = category.classification === "expense";
  const chartLabel = isExpense ? "Spent" : "Income";

  // Chart buckets at the chosen granularity — over the date-picker window set.
  // The whole window set is sent to the client; clicking a bar isolates the
  // table to that bucket purely client-side (no server round-trip).
  const granularity = parseDetailGranularity(firstValue(sp.chartG));
  const chartData = bucketByGranularity(
    allTransactions.map((t) => ({ dateISO: t.originalDate || t.date, value: isExpense ? -t.amount : t.amount })),
    granularity,
  );

  // Top merchants — over the FILTERED set; rendered as a compact strip.
  const byMerchant = new Map<string, { total: number; count: number }>();
  for (const t of allTransactions) {
    const merchant = t.customName ?? t.canonicalName ?? t.name;
    const bucket = byMerchant.get(merchant) ?? { total: 0, count: 0 };
    bucket.total += isExpense ? -t.amount : t.amount;
    bucket.count += 1;
    byMerchant.set(merchant, bucket);
  }
  const topMerchants = [...byMerchant.entries()]
    .map(([merchant, { total, count }]) => ({ merchant, total: Math.round(total * 100) / 100, count }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);

  // Earliest / latest aggregation date across the filtered set — feeds the
  // filter bar's "All Time" subline.
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
      excluded: t.userOverrides.excluded === true || category.classification === "ignored",
      oneTime: t.userOverrides.oneTime === true,
      accountId: t.accountId,
      profileId: t.profileId,
    }));

  const linkedRefunds = buildLinkedRefundRows(
    new Set(txRows.map((r) => r.id)),
    allPairs,
    txRepo,
    () => category.classification === "ignored",
  );
  const profileOptions = accessibleProfiles().map((p) => ({ id: p.id, displayName: p.displayName, color: p.color }));

  // Categories the edit dropdowns need (assigning a tx to any category).
  const categoryObjects = makeCategoryRepo(db).list();
  const allCategories = Array.from(new Set([
    ...categoryObjects.map((c) => c.displayName),
    ...txRepo.distinctCategories(),
  ])).sort((a, b) => a.localeCompare(b));

  const accountInfos = accounts.map((a) => ({
    id: a.id,
    accountName: a.accountName,
    customName: a.customName ?? null,
    institutionName: a.institutionName,
    accountNumberLast4: a.accountNumberLast4,
    tags: a.tags,
  }));

  return (
    <main style={{ padding: "2rem", maxWidth: 1100, margin: "0 auto" }}>
      <Link
        href="/categories"
        style={{ fontSize: "0.975rem", opacity: 0.6, textDecoration: "none", display: "inline-block", marginBottom: "1.25rem" }}
      >
        ← Categories
      </Link>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem" }}>
        <CategoryIconPicker
          category={{
            displayName: category.displayName,
            color: category.color,
            icon: category.icon,
          }}
          size={28}
        />
        <h1 style={{ fontSize: "1.625rem", fontWeight: 700, margin: 0 }}>{category.displayName}</h1>
        <span style={{ fontSize: "0.875rem", fontWeight: 600, color: classColor, border: `1px solid ${classColor}`, borderRadius: 4, padding: "0.15rem 0.5rem" }}>
          {classLabel}
        </span>
        <DeleteCategoryButton categoryName={category.displayName} />
      </div>

      {/* Stats row — reflects the active filters */}
      <div style={{ display: "flex", gap: "2rem", fontSize: "0.975rem", opacity: 0.7, marginBottom: "0.75rem", flexWrap: "wrap" }}>
        <span>{allTransactions.length} transaction{allTransactions.length !== 1 ? "s" : ""}</span>
        {isExpense ? (
          <>
            {expenses.length > 0 && (
              <span style={{ color: "#a00" }}>Total charges: <span data-sensitive>{formatMoney(Math.abs(expenses.reduce((s, t) => s + t.amount, 0)))}</span></span>
            )}
            {income.length > 0 && (
              <span style={{ color: "#070" }}>Refunds: <span data-sensitive>{formatMoney(income.reduce((s, t) => s + t.amount, 0))}</span></span>
            )}
            {allTransactions.length > 0 && (
              <span style={{ color: totalAmount < 0 ? "#a00" : "#070", fontWeight: 600 }}>
                Net spent: <span data-sensitive>{formatMoney(Math.abs(totalAmount))}</span>
              </span>
            )}
          </>
        ) : category.classification === "income" ? (
          <>
            {income.length > 0 && (
              <span style={{ color: "#070" }}>Total received: <span data-sensitive>{formatMoney(income.reduce((s, t) => s + t.amount, 0))}</span></span>
            )}
            {expenses.length > 0 && (
              <span style={{ color: "#a00" }}>Deductions: <span data-sensitive>{formatMoney(Math.abs(expenses.reduce((s, t) => s + t.amount, 0)))}</span></span>
            )}
            {allTransactions.length > 0 && (
              <span style={{ color: totalAmount > 0 ? "#070" : "#a00", fontWeight: 600 }}>
                Net income: <span data-sensitive>{formatMoney(Math.abs(totalAmount))}</span>
              </span>
            )}
          </>
        ) : (
          <>
            {expenses.length > 0 && (
              <span style={{ color: "#a00" }}>Out: <span data-sensitive>{formatMoney(Math.abs(expenses.reduce((s, t) => s + t.amount, 0)))}</span></span>
            )}
            {income.length > 0 && (
              <span style={{ color: "#070" }}>In: <span data-sensitive>{formatMoney(income.reduce((s, t) => s + t.amount, 0))}</span></span>
            )}
            {allTransactions.length > 0 && expenses.length > 0 && income.length > 0 && (
              <span style={{ color: totalAmount < 0 ? "#a00" : "#070" }}>Net: <span data-sensitive>{formatMoney(totalAmount)}</span></span>
            )}
          </>
        )}
      </div>

      {/* Compact top-merchants strip — chips link to merchant detail pages */}
      {topMerchants.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem 0.6rem", alignItems: "baseline", marginBottom: "1.5rem", fontSize: "0.9rem" }}>
          <span style={{ fontSize: "0.8rem", fontWeight: 700, letterSpacing: "0.06em", color: "#999", textTransform: "uppercase", marginRight: "0.25rem" }}>
            Top merchants
          </span>
          {topMerchants.map(({ merchant, total, count }) => (
            <Link
              key={merchant}
              href={`/merchants/${encodeURIComponent(merchant)}`}
              data-sensitive
              title={`${merchant} · ${count} txn${count !== 1 ? "s" : ""}`}
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
              <span style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>{merchant}</span>
              <span style={{ fontVariantNumeric: "tabular-nums", color: isExpense ? "#a00" : "#070", fontWeight: 600 }}>
                {formatMoney(total)}
              </span>
            </Link>
          ))}
        </div>
      )}

      {/* Full transactions-style filter bar — WITHOUT the category section
          (this page is already scoped to one category). */}
      <TransactionFiltersBar
        accounts={accounts.map((a) => ({
          id: a.id,
          label: formatAccountLabel(a),
          profileId: a.profileId,
          accountGroup: a.accountGroup,
        }))}
        profiles={profileOptions}
        tags={tags.map((t) => ({ id: t.id, displayName: t.displayName }))}
        categories={[]}
        searchPlaceholder="Search name, description, note…"
        dataMinDate={dataMinDate}
        dataMaxDate={dataMaxDate}
        defaultExcluded={defaultExcluded}
      />

      {/* Chart + transaction list (client component) */}
      <CategoryTransactionSection
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
