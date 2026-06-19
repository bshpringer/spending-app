import Link from "next/link";
import { getDb } from "@/lib/db.ts";
import { makePlaidBalanceRepo } from "@/lib/repo/plaidBalanceRepo.ts";
import { makePlaidItemRepo } from "@/lib/repo/plaidItemRepo.ts";
import { makePlaidStagingRepo } from "@/lib/repo/plaidStagingRepo.ts";
import { makePlaidStagingRemovalsRepo } from "@/lib/repo/plaidStagingRemovalsRepo.ts";
import { makeTransactionRepo } from "@/lib/repo/transactionRepo.ts";
import { makeRuleRepo } from "@/lib/repo/ruleRepo.ts";
import { makeCategoryRepo } from "@/lib/repo/categoryRepo.ts";
import { makePrefsRepo } from "@/lib/repo/prefsRepo.ts";
import { makeAccountRepo } from "@/lib/repo/accountRepo.ts";
import { makeTagRepo } from "@/lib/repo/tagRepo.ts";
import { makeRefundMatchRepo } from "@/lib/repo/refundMatchRepo.ts";
import { resolveProfileFilter, accessibleProfiles } from "@/lib/auth.ts";
import { applyNetting } from "@/lib/refundNetting.ts";
import { buildLinkedRefundRows } from "@/lib/refundNetting.ts";
import { computePacing, type PacingGranularity } from "@/lib/pacing.ts";
import { NetWorthClient } from "./NetWorthClient.tsx";
import { PacingClient } from "./PacingClient.tsx";
import { SyncAllButton } from "./SyncAllButton.tsx";
import { DashboardTabs, type DashboardTab } from "./DashboardTabs.tsx";
import { RefreshBalancesButton } from "./RefreshBalancesButton.tsx";
import { type ColumnDef, type TxRow } from "../transactions/BulkEditTable.tsx";
import { DashboardRecentClient } from "./DashboardRecentClient.tsx";

export const dynamic = "force-dynamic";

const RECENT_PAGE_SIZE = 20;

function pacingWindowStart(anchor: Date, g: PacingGranularity): string {
  const y = anchor.getFullYear();
  const m = anchor.getMonth();
  let start: Date;
  if (g === "month") {
    start = new Date(y, m - 1, 1); // first of previous month
  } else if (g === "quarter") {
    const qStartMonth = Math.floor(m / 3) * 3;
    // first of previous quarter
    start = new Date(y, qStartMonth - 3, 1);
  } else {
    // first of previous year
    start = new Date(y - 1, 0, 1);
  }
  return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-01`;
}

function parseGranularity(raw: string | undefined): PacingGranularity {
  return raw === "quarter" || raw === "year" ? raw : "month";
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ profile?: string; tab?: string; page?: string; pacingG?: string }>;
}) {
  const params = await searchParams;
  const profileIds = resolveProfileFilter(params.profile);
  const tab: DashboardTab = params.tab === "net-worth" ? "net-worth" : "this-month";
  const pacingG = parseGranularity(params.pacingG);

  const db = getDb();
  const stagedCounts = makePlaidStagingRepo(db).countsByItem();
  const removalCounts = makePlaidStagingRemovalsRepo(db).countsByItem();
  const plaidItems = makePlaidItemRepo(db).list().map((it) => ({
    itemId: it.itemId,
    institutionName: it.institutionName,
    lastSyncedAt: it.lastSyncedAt,
    stagedCount: stagedCounts.get(it.itemId) ?? 0,
    removalCount: removalCounts.get(it.itemId) ?? 0,
  }));

  return (
    <main style={{ padding: "2rem", maxWidth: 1200, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
      <DashboardTabs active={tab} profile={params.profile} />

      {tab === "this-month" ? (
        <ThisMonthTab profileIds={profileIds} profileParam={params.profile} plaidItems={plaidItems} pacingG={pacingG} />
      ) : (
        <NetWorthTab profileIds={profileIds} />
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Tab 1 — This Month
// ---------------------------------------------------------------------------

async function ThisMonthTab({
  profileIds,
  profileParam,
  plaidItems,
  pacingG,
}: {
  profileIds: string[] | null;
  profileParam: string | undefined;
  plaidItems: { itemId: string; institutionName: string | null; lastSyncedAt: string | null; stagedCount: number; removalCount: number }[];
  pacingG: PacingGranularity;
}) {
  const db = getDb();
  const anchor = new Date();
  const txRepo = makeTransactionRepo(db);
  const refundRepo = makeRefundMatchRepo(db);
  const rules = makeRuleRepo(db).list().filter((r) => r.enabled);
  const hideExcludedDefault = makePrefsRepo(db).getAll().hideExcludedByDefault;
  const categoryRepo = makeCategoryRepo(db);
  const categoryObjects = categoryRepo.list();
  const categoryMap = new Map(categoryObjects.map((c) => [c.displayName, c]));
  const accountRepo = makeAccountRepo(db);
  const accountTagMap = accountRepo.tagMap();

  // ---- Pacing (current + previous period window) ----
  const rawPacingTxs = txRepo.query({
    profileIds: profileIds ?? undefined,
    from: pacingWindowStart(anchor, pacingG),
  });
  const { transactions: pacingTxs, nettedRefundIds: pacingNettedRefundIds } = applyNetting(rawPacingTxs, txRepo, refundRepo, "date-window");
  const pacing = computePacing(pacingTxs, rules, categoryMap, accountTagMap, pacingG, anchor, pacingNettedRefundIds);

  // ---- Recent transactions (sorted newest first by canonical agg date) ----
  const rawRecent = txRepo.query({
    profileIds: profileIds ?? undefined,
    sort: "date",
    dir: "desc",
    excludedFilter: hideExcludedDefault ? "hide" : "all",
  });
  const confirmedPairs = refundRepo.allConfirmedPairs();
  const suppressedRefundIds = new Set(confirmedPairs.map((p) => p.refundId));
  const filteredRecent = rawRecent.filter((t) => !suppressedRefundIds.has(t.id));

  const totalRecent = filteredRecent.length;
  const pageRows = filteredRecent.slice(0, RECENT_PAGE_SIZE);

  const accounts = accountRepo.list();
  const tags = makeTagRepo(db).list();
  const categories = Array.from(new Set([
    ...categoryObjects.map((c) => c.displayName),
    ...txRepo.distinctCategories(),
  ])).sort((a, b) => a.localeCompare(b));
  const profileOptions = accessibleProfiles().map((p) => ({ id: p.id, displayName: p.displayName, color: p.color }));
  const accountInfos = accounts.map((a) => ({
    id: a.id,
    accountName: a.accountName,
    customName: a.customName ?? null,
    institutionName: a.institutionName,
    accountNumberLast4: a.accountNumberLast4,
    tags: a.tags,
  }));

  const txRows = pageRows.map((t) => ({
    id: t.id,
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

  const linkedRefunds = buildLinkedRefundRows(
    new Set(txRows.map((r) => r.id)),
    confirmedPairs,
    txRepo,
  );

  const columns: ColumnDef[] = [
    { key: "date", label: "Date" },
    { key: "name", label: "Name" },
    { key: "category", label: "Category" },
    { key: "amount", label: "Amount" },
    { key: "account", label: "Account" },
    { key: "tags", label: "Tags" },
    { key: "edit", label: "" },
  ];

  const profileQs = profileParam && profileParam !== "all" ? `?profile=${encodeURIComponent(profileParam)}` : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <SyncAllButton items={plaidItems} />
      <PacingClient
        pacing={pacing}
        granularity={pacingG}
        profileParam={profileParam}
        profileIds={profileIds}
        accounts={accountInfos}
        availableTags={tags.map((t) => ({ id: t.id, displayName: t.displayName }))}
        availableCategories={categories}
        profiles={profileOptions}
      />

      <section style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <div style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: "1rem",
          flexWrap: "wrap",
        }}>
          <h2 style={{ fontSize: "1.75em", margin: 0, fontWeight: 600 }}>Latest Transactions</h2>
          <Link
            href={`/transactions${profileQs}`}
            style={{ fontSize: "0.9rem", color: "#1a1f3a", textDecoration: "underline" }}
          >
            View all transactions →
          </Link>
        </div>

        {filteredRecent.length === 0 ? (
          <p style={{ opacity: 0.7 }}>No transactions yet.</p>
        ) : (
          <>
            <DashboardRecentClient
              initialRows={txRows as TxRow[]}
              initialTotal={totalRecent}
              initialLinkedRefunds={Object.fromEntries(linkedRefunds) as Record<string, TxRow[]>}
              baseFilters={{ profileIds: profileIds ?? undefined, sort: "date", dir: "desc" }}
              pageSize={RECENT_PAGE_SIZE}
              accounts={accountInfos}
              columns={columns}
              availableTags={tags.map((t) => ({ id: t.id, displayName: t.displayName }))}
              availableCategories={categories}
              profiles={profileOptions}
            />
            {/* pagination handled inside DashboardRecentClient */}
          </>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 2 — Net Worth
// ---------------------------------------------------------------------------

async function NetWorthTab({ profileIds }: { profileIds: string[] | null }) {
  const db = getDb();
  const balanceRepo = makePlaidBalanceRepo(db);
  const balances = balanceRepo.latestAll(profileIds);
  const daily = balanceRepo.historyDailyAll(profileIds);
  const lastUpdated = balances.reduce<string | null>(
    (acc, b) => (acc == null || b.asOf > acc ? b.asOf : acc),
    null,
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <RefreshBalancesButton lastUpdated={lastUpdated} />
      <NetWorthClient balances={balances} daily={daily} />
    </div>
  );
}
