import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { makeTransactionRepo, type TransactionFilters } from "@/lib/repo/transactionRepo";
import { makeAccountRepo } from "@/lib/repo/accountRepo";
import { makeTagRepo } from "@/lib/repo/tagRepo";
import { makeCategoryRepo } from "@/lib/repo/categoryRepo";
import { makePrefsRepo } from "@/lib/repo/prefsRepo.ts";
import { TransactionFiltersBar } from "./TransactionFilters.tsx";
import { type ColumnDef, type TxRow } from "./BulkEditTable.tsx";
import { TransactionsTableClient } from "./TransactionsTableClient.tsx";
import { makeRefundMatchRepo } from "@/lib/repo/refundMatchRepo";
import { applyNetting, buildLinkedRefundRows } from "@/lib/refundNetting";
import { ManualEntryModal } from "./ManualEntryModal.tsx";
import { formatMoney, formatAccountLabel } from "@/lib/format";
import { accessibleProfiles } from "@/lib/auth";
import { FEATURES } from "@/lib/appMode.ts";
import { aggregationDate } from "@/lib/period.ts";
import { parseTransactionFilters, firstValue } from "@/lib/transactionFilterParams.ts";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ [k: string]: string | string[] | undefined }>;

export default async function TransactionsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;

  // Default the date window to the last 30 days on a bare visit. Without this,
  // "no date param" means All Time. We make Last 30 Days the default by
  // redirecting a bare URL to an explicit ?from&to range; the All Time pill
  // opts back out via an explicit ?dates=all sentinel (kept reachable). Skip
  // when an import batch is under review (those rows may predate 30 days) or
  // when any date intent is already present.
  const hasDateIntent = sp.from !== undefined || sp.to !== undefined || sp.dates !== undefined;
  if (!hasDateIntent && sp.batch === undefined) {
    const todayD = new Date();
    const fromD = new Date(todayD);
    fromD.setDate(fromD.getDate() - 30);
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      const val = Array.isArray(v) ? v[0] : v;
      if (val !== undefined) params.set(k, val);
    }
    params.set("from", fromD.toISOString().split("T")[0]);
    params.set("to", todayD.toISOString().split("T")[0]);
    redirect(`/transactions?${params.toString()}`);
  }
  const datesAll = firstValue(sp.dates) === "all";

  // App-wide preferences. `hideExcludedByDefault` flips the fallback for the
  // excluded filter when the URL doesn't specify one; the filter bar uses the
  // same default so its dropdown + "Clear all" stay in sync (and an explicit
  // "All" survives because the bar only omits the param at the default value).
  const db = getDb();
  const prefs = makePrefsRepo(db).getAll();
  const defaultExcluded: "all" | "hide" = prefs.hideExcludedByDefault ? "hide" : "all";

  const {
    filters,
    sort,
    dir,
    excludedFilter,
    oneTimeFilter,
    canonicalFilter,
    sourceFilter,
    netExcluded,
    batchId,
    profileParam,
    profileIds,
    amountOp,
    amountValue,
    amountMax,
  } = parseTransactionFilters(sp, { defaultExcluded });
  type SortCol = typeof sort;

  // The All Time sentinel removes the date window entirely.
  if (datesAll) {
    filters.from = undefined;
    filters.to = undefined;
  }

  const txRepo = makeTransactionRepo(db);
  const refundMatchRepo = makeRefundMatchRepo(db);
  const rawMatches = txRepo.query(filters);

  // Unconditionally suppress any transaction that is a confirmed refund.
  // It will only be rendered as a nested child row if its linked expense passes filters.
  const confirmedPairs = refundMatchRepo.allConfirmedPairs();
  const suppressedRefundIds = new Set(confirmedPairs.map((p) => p.refundId));
  const allMatches = rawMatches.filter((t) => !suppressedRefundIds.has(t.id));

  // For the stats row only: pull confirmed refunds linked to in-set expenses
  // (even when those refunds live outside the date/category filter), so the
  // Spent / Net totals net the refund into its expense's bucket — matching
  // how /trends, /dashboard, /categories/[name] etc. already aggregate.
  // The visible table above is unchanged; this affects only the math.
  const { transactions: nettedForStats } = applyNetting(
    rawMatches,
    txRepo,
    refundMatchRepo,
    "scoped",
  );
  const accounts = makeAccountRepo(db).list();
  const tags = makeTagRepo(db).list();
  const categoryObjects = makeCategoryRepo(db).list();
  const categoryMap = new Map(categoryObjects.map((c) => [c.displayName, c]));
  // Full list (for edit dropdowns / bulk actions / manual entry — user may
  // want to assign a transaction to an empty category).
  const categories = Array.from(new Set([
    ...categoryObjects.map((c) => c.displayName),
    ...txRepo.distinctCategories()
  ])).sort((a, b) => a.localeCompare(b));
  // Filter-chip list trimmed to categories that actually appear in
  // transactions for the CURRENT context — respects every other filter
  // (dates / profile / accounts / amount / status dropdowns / tags) except
  // `search` (would thrash on every keystroke) and `categories` itself
  // (otherwise picking one chip would hide all the others).
  const categoryNamesInContext = txRepo.distinctCategoriesMatching({
    ...filters,
    search: undefined,
    categories: undefined,
  });
  const categoryMeta: {
    name: string;
    icon: string | null;
    color: string | null;
    classification: "expense" | "income" | "ignored" | null;
  }[] = categoryNamesInContext.map((name) => {
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

  // Netting remaps a confirmed refund onto its EXPENSE's date (e.g. a refund
  // that posted 6/1 but offsets a 5/25 charge is moved to 5/25). Re-apply the
  // page's date window to the post-netting aggregation date so the refund only
  // nets into the period its expense lives in — otherwise a June-posted refund
  // for a May charge wrongly reduces June's Spent. (Non-refund rows keep their
  // own date, so for them this is the same window the SQL query already used.)
  // This mirrors how /trends + /dashboard pacing re-bucket by date after
  // netting. No bounds set (All Time) → no-op.
  const inStatsWindow = (t: (typeof nettedForStats)[number]): boolean => {
    const d = aggregationDate(t);
    if (filters.from && d < filters.from) return false;
    if (filters.to && d > filters.to) return false;
    return true;
  };

  const totalsBase = (netExcluded
    ? nettedForStats
    : nettedForStats.filter(
        (t) =>
          t.userOverrides.excluded !== true &&
          categoryMap.get(t.category)?.classification !== "ignored",
      )
  ).filter(inStatsWindow);
  // Classification-aware bucketing — mirrors computeMonthlyTotals so the
  // stats row agrees with the Trends page. A refund (positive amount) in an
  // expense category nets out against spend rather than counting as income.
  let incomeTotal = 0;
  let spentTotal = 0;
  for (const t of totalsBase) {
    const classification = categoryMap.get(t.category)?.classification;
    if (classification === "income") {
      incomeTotal += t.amount;
    } else {
      spentTotal -= t.amount;
    }
  }
  // spentTotal is stored as a positive number (cumulative spend). Net = income − spend.
  const netTotal = incomeTotal - spentTotal;

  const PAGE_SIZE = 50;
  const transactions = allMatches.slice(0, PAGE_SIZE);

  // Earliest / latest aggregation date across the current filtered set — used
  // by the filter bar's "Data spans" subline so "All Time" isn't opaque.
  let dataMinDate: string | null = null;
  let dataMaxDate: string | null = null;
  for (const t of allMatches) {
    const d = t.originalDate || t.date;
    if (!d) continue;
    if (dataMinDate === null || d < dataMinDate) dataMinDate = d;
    if (dataMaxDate === null || d > dataMaxDate) dataMaxDate = d;
  }

  function buildParams(overrides: Record<string, string | undefined> = {}): string {
    const params = new URLSearchParams();
    if (filters.search) params.set("q", filters.search);
    if (filters.tagIds?.length) params.set("tags", filters.tagIds.join(","));
    if (filters.accountIds?.length) params.set("accounts", filters.accountIds.join(","));
    if (filters.categories?.length) params.set("categories", filters.categories.join(","));
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    if (datesAll) params.set("dates", "all");
    if (sort !== "date") params.set("sort", sort);
    if (dir !== "desc") params.set("dir", dir);
    if (excludedFilter !== defaultExcluded) params.set("excluded", excludedFilter);
    if (oneTimeFilter !== "all") params.set("oneTime", oneTimeFilter);
    if (canonicalFilter !== "all") params.set("canonical", canonicalFilter);
    if (sourceFilter) params.set("source", sourceFilter);
    if (batchId) params.set("batch", batchId);
    if (profileParam && profileParam !== "all") params.set("profile", profileParam);
    if (amountOp) params.set("amountOp", amountOp);
    if (amountValue != null) params.set("amountVal", String(amountValue));
    if (amountMax != null) params.set("amountMax", String(amountMax));
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined) params.delete(k);
      else params.set(k, v);
    }
    const qs = params.toString();
    return qs ? `/transactions?${qs}` : "/transactions";
  }

  function sortUrl(col: SortCol) {
    const nextDir = sort === col && dir === "desc" ? "asc" : "desc";
    return buildParams({ sort: col, dir: nextDir });
  }

  const columns: ColumnDef[] = [
    { key: "date", label: "Date", sortHref: sortUrl("date"), sortActive: sort === "date", sortDir: dir },
    { key: "name", label: "Name", sortHref: sortUrl("name"), sortActive: sort === "name", sortDir: dir },
    { key: "category", label: "Category", sortHref: sortUrl("category"), sortActive: sort === "category", sortDir: dir },
    { key: "amount", label: "Amount", sortHref: sortUrl("amount"), sortActive: sort === "amount", sortDir: dir },
    { key: "account", label: "Account" },
    { key: "tags", label: "Tags" },
    { key: "edit", label: "" },
  ];

  const txRows = transactions.map((t) => ({
    id: t.id,
    // Display the authorized/transacted date (when the user swiped) — falls
    // back to the posted date for older rows where originalDate is missing.
    // Posted date remains in the DB on `transactions.date` for unchanged
    // aggregations (Trends/pacing month buckets) and SQL filters.
    date: t.originalDate || t.date,
    name: t.name,
    customName: t.customName,
    canonicalName: t.canonicalName,
    category: t.category,
    amount: t.amount,
    note: t.note,
    tags: t.tags,
    excluded: t.userOverrides.excluded === true || categoryMap.get(t.category)?.classification === "ignored",
    oneTime: t.userOverrides.oneTime === true,
    accountId: t.accountId,
    profileId: t.profileId,
  }));

  const profileOptions = accessibleProfiles().map((p) => ({ id: p.id, displayName: p.displayName, color: p.color }));

  const accountInfos = accounts.map((a) => ({
    id: a.id,
    accountName: a.accountName,
    customName: a.customName ?? null,
    institutionName: a.institutionName,
    accountNumberLast4: a.accountNumberLast4,
    tags: a.tags,
  }));

  const linkedRefunds = buildLinkedRefundRows(
    new Set(txRows.map((r) => r.id)),
    confirmedPairs,
    txRepo,
  );

  return (
    <main style={{ padding: "2rem", maxWidth: 1400, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "0 0 1rem", gap: "1rem", flexWrap: "wrap" }}>
        <h1 style={{ fontSize: "1.625rem", margin: 0 }}>Transactions</h1>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <Link
            href={`/refunds${firstValue(sp.profile) ? `?profile=${encodeURIComponent(firstValue(sp.profile)!)}` : ""}`}
            style={{
              padding: "0.4rem 0.9rem",
              border: "1px solid #ccc",
              borderRadius: 4,
              background: "transparent",
              color: "inherit",
              textDecoration: "none",
              fontSize: "0.925rem",
            }}
            title="Pair refunds with their original charges"
          >
            Refunds
          </Link>
          <Link
            href={`/duplicates${firstValue(sp.profile) ? `?profile=${encodeURIComponent(firstValue(sp.profile)!)}` : ""}`}
            style={{
              padding: "0.4rem 0.9rem",
              border: "1px solid #ccc",
              borderRadius: 4,
              background: "transparent",
              color: "inherit",
              textDecoration: "none",
              fontSize: "0.925rem",
            }}
            title="Review transaction pairs that look like duplicates"
          >
            Duplicates
          </Link>
          {FEATURES.crossSourceReconcile && (
            <Link
              href={`/reconcile${firstValue(sp.profile) ? `?profile=${encodeURIComponent(firstValue(sp.profile)!)}` : ""}`}
              style={{
                padding: "0.4rem 0.9rem",
                border: "1px solid #ccc",
                borderRadius: 4,
                background: "transparent",
                color: "inherit",
                textDecoration: "none",
                fontSize: "0.925rem",
              }}
              title="Enrich old Rocket rows with their Plaid twins (cross-source reconciliation)"
            >
              Reconcile
            </Link>
          )}
          <ManualEntryModal
            accounts={accounts.map((a) => ({ id: a.id, label: formatAccountLabel(a), profileId: a.profileId }))}
            availableCategories={categories}
            availableTags={tags.map((t) => ({ id: t.id, displayName: t.displayName }))}
            profiles={profileOptions}
            defaultProfileId={profileIds?.[0]}
          />
        </div>
      </div>

      {batchId && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "1rem",
            padding: "0.75rem 1rem",
            marginBottom: "1rem",
            background: "rgba(34,170,85,0.10)",
            border: "1px solid #2a7",
            borderRadius: 6,
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontSize: "1.025rem" }}>
            <strong>Reviewing latest import.</strong>{" "}
            <span style={{ opacity: 0.75 }}>
              {allMatches.length} new transaction{allMatches.length === 1 ? "" : "s"} — edit, tag, or delete below.
            </span>
          </div>
          <Link
            href="/transactions"
            style={{
              padding: "0.35rem 0.8rem",
              border: "1px solid #2a7",
              borderRadius: 4,
              textDecoration: "none",
              color: "inherit",
              fontSize: "0.945rem",
              background: "#fff",
            }}
          >
            Done reviewing
          </Link>
        </div>
      )}

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
        dataMinDate={dataMinDate}
        dataMaxDate={dataMaxDate}
        defaultExcluded={defaultExcluded}
        allTimeSentinel
      />

      <div style={{ display: "flex", gap: "1.5rem", alignItems: "baseline", margin: "1rem 0", fontSize: "1.025rem", flexWrap: "wrap" }}>
        <span><strong>{allMatches.length}</strong> match{allMatches.length === 1 ? "" : "es"}</span>
        {incomeTotal > 0 && (
          <span>Income: <strong style={{ color: "#070" }} data-sensitive>{formatMoney(incomeTotal)}</strong></span>
        )}
        {spentTotal > 0 && (
          <span>Spent: <strong style={{ color: "#a00" }} data-sensitive>{formatMoney(spentTotal)}</strong></span>
        )}
        <span>Net: <strong style={{ color: netTotal < 0 ? "#a00" : "#070" }} data-sensitive>{formatMoney(netTotal)}</strong></span>
      </div>

      {allMatches.length === 0 ? (
        <p style={{ opacity: 0.7 }}>
          Nothing matches.{" "}
          <Link href="/transactions" style={{ textDecoration: "underline" }}>Clear filters</Link>{" "}
          or{" "}
          {FEATURES.csvImport ? (
            <Link href="/settings/import" style={{ textDecoration: "underline" }}>import a CSV</Link>
          ) : (
            <Link href="/settings/plaid" style={{ textDecoration: "underline" }}>connect a bank</Link>
          )}.
        </p>
      ) : (
        <TransactionsTableClient
          initialRows={txRows as TxRow[]}
          initialTotal={allMatches.length}
          initialLinkedRefunds={Object.fromEntries(linkedRefunds) as Record<string, TxRow[]>}
          filters={filters}
          pageSize={PAGE_SIZE}
          accounts={accountInfos}
          columns={columns}
          availableTags={tags.map((t) => ({ id: t.id, displayName: t.displayName }))}
          availableCategories={categories}
          profiles={profileOptions}
        />
      )}
    </main>
  );
}
