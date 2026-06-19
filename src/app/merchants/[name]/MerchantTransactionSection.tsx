"use client";

import { useEffect, useMemo, useState } from "react";
import { BulkEditTable, clientSortRows, type TxRow, type AccountInfo } from "../../transactions/BulkEditTable.tsx";
import { AccordionPagination } from "../../transactions/AccordionPagination.tsx";
import { CategoryTrendChart } from "../../categories/[name]/CategoryTrendChart.tsx";
import { ChartGranularityPills } from "../../categories/[name]/ChartGranularityPills.tsx";
import { useExcludedFilterSync } from "../../categories/[name]/useExcludedFilterSync.ts";
import { bucketRange, type DetailBucket, type DetailGranularity } from "@/lib/detailChart.ts";

const PAGE_SIZE = 50;

const GRANULARITY_PREFIX: Record<DetailGranularity, string> = {
  month: "Monthly",
  quarter: "Quarterly",
  year: "Yearly",
};

interface Props {
  transactions: TxRow[];
  accounts: AccountInfo[];
  chartData: DetailBucket[];
  granularity: DetailGranularity;
  chartColor: string;
  chartLabel: string;
  availableTags: { id: string; displayName: string }[];
  availableCategories: string[];
  profiles?: { id: string; displayName: string; color?: string }[];
  linkedRefunds?: Map<string, TxRow[]>;
  emptyMessage: string;
}

const columns = [
  { key: "date", label: "Date" },
  { key: "name", label: "Name" },
  { key: "category", label: "Category" },
  { key: "amount", label: "Amount" },
  { key: "account", label: "Account" },
  { key: "tags", label: "Tags" },
  { key: "edit", label: "" },
];

const COL_WIDTHS: Record<string, string> = {
  date: "110px",
  name: "26%",
  category: "16%",
  amount: "110px",
  account: "22%",
  tags: "auto",
  edit: "56px",
};

export function MerchantTransactionSection({
  transactions,
  accounts,
  chartData,
  granularity,
  chartColor,
  chartLabel,
  availableTags,
  availableCategories,
  profiles,
  linkedRefunds,
  emptyMessage,
}: Props) {
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState<string>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  // Bar selection is pure client state — instant isolation, no server round-trip.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const activeBucket = chartData.find((b) => b.key === selectedKey) ?? null;
  const { hideExcluded, onHideExcludedChange } = useExcludedFilterSync();

  function onBarToggle(key: string) {
    setSelectedKey((prev) => (prev === key ? null : key));
    setPage(0);
  }

  // Reset page + drop any bar selection when the server sends a fresh window set.
  useEffect(() => { setPage(0); setSelectedKey(null); }, [transactions]);

  // Isolate to the selected bucket (client-side), then sort the FULL set, then
  // paginate.
  const visibleTransactions = useMemo(() => {
    if (!activeBucket) return transactions;
    const r = bucketRange(activeBucket.key, granularity);
    return transactions.filter((t) => t.date >= r.from && t.date <= r.to);
  }, [transactions, activeBucket, granularity]);
  const sorted = useMemo(
    () => clientSortRows(visibleTransactions, sortKey, sortDir),
    [visibleTransactions, sortKey, sortDir],
  );
  const pageRows = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <>
      <div style={{ background: "#fff", border: "1px solid #eee", borderRadius: 8, padding: "1rem 1rem 0.5rem", margin: "1.5rem 0 2rem" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", marginBottom: "0.5rem" }}>
          <h2 style={{ fontSize: "0.875rem", fontWeight: 700, letterSpacing: "0.06em", color: "#888", margin: 0, textTransform: "uppercase", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
            {GRANULARITY_PREFIX[granularity]} {chartLabel}
            <span style={{ marginLeft: "0.6rem", fontWeight: 400, fontStyle: "italic", textTransform: "none", letterSpacing: 0, opacity: activeBucket ? 1 : 0.5 }}>
              — {activeBucket ? `transactions isolated to ${activeBucket.label} — click again to clear` : "click a bar to isolate its transactions"}
            </span>
          </h2>
          <ChartGranularityPills current={granularity} />
        </div>
        <div style={{ height: 180 }}>
          <CategoryTrendChart
            data={chartData}
            color={chartColor}
            label={chartLabel}
            selectedKeys={activeBucket ? [activeBucket.key] : []}
            onBarToggle={onBarToggle}
          />
        </div>
      </div>

      <h2 style={{ fontSize: "0.875rem", fontWeight: 700, letterSpacing: "0.06em", color: "#888", margin: "0 0 0.75rem", textTransform: "uppercase" }}>
        Transactions
      </h2>

      <BulkEditTable
        transactions={pageRows}
        accounts={accounts}
        columns={columns}
        availableTags={availableTags}
        availableCategories={availableCategories}
        profiles={profiles}
        linkedRefunds={linkedRefunds}
        controlledSort={{
          sortKey,
          sortDir,
          onChange: (key, dir) => { setSortKey(key); setSortDir(dir); setPage(0); },
        }}
        hideExcluded={hideExcluded}
        onHideExcludedChange={onHideExcludedChange}
        linkCategory
        colWidths={COL_WIDTHS}
        emptyMessage={<p style={{ opacity: 0.6, padding: "1rem 0" }}>{emptyMessage}</p>}
        toolbarExtras={
          visibleTransactions.length > PAGE_SIZE ? (
            <AccordionPagination
              page={page}
              pageSize={PAGE_SIZE}
              total={visibleTransactions.length}
              loading={false}
              onPage={setPage}
            />
          ) : null
        }
      />
    </>
  );
}
