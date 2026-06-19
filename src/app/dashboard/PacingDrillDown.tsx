"use client";

import { useEffect, useState, useTransition } from "react";
import { getPacingDrillTransactionsPage } from "@/lib/actions.ts";
import type { CategoryTxPage } from "@/lib/categoryDateRange.ts";
import {
  BulkEditTable,
  type AccountInfo,
  type ColumnDef,
  type TxRow,
} from "../transactions/BulkEditTable.tsx";
import { AccordionPagination } from "../transactions/AccordionPagination.tsx";

interface Props {
  /** Current-period bucket range (inclusive). */
  currentFrom: string | null;
  currentTo: string | null;
  /** Previous-period analog range (inclusive). */
  previousFrom: string | null;
  previousTo: string | null;
  currentLabel: string;
  previousLabel: string;
  profileIds: string[] | null;
  accounts: AccountInfo[];
  availableTags: { id: string; displayName: string }[];
  availableCategories: string[];
  profiles?: { id: string; displayName: string; color?: string }[];
}

const PAGE_SIZE = 5;

const COLUMNS: ColumnDef[] = [
  { key: "date", label: "Date" },
  { key: "name", label: "Name" },
  { key: "category", label: "Category" },
  { key: "amount", label: "Amount" },
  { key: "account", label: "Account" },
  { key: "tags", label: "Tags" },
  { key: "edit", label: "" },
];

type SortKey = "date" | "name" | "amount";

interface SidePanelProps {
  heading: string;
  from: string | null;
  to: string | null;
  profileIds: string[] | null;
  accounts: AccountInfo[];
  availableTags: { id: string; displayName: string }[];
  availableCategories: string[];
  profiles?: { id: string; displayName: string; color?: string }[];
}

function SidePanel({
  heading,
  from,
  to,
  profileIds,
  accounts,
  availableTags,
  availableCategories,
  profiles,
}: SidePanelProps) {
  const [page, setPage] = useState(0);
  const [data, setData] = useState<CategoryTxPage | null>(null);
  const [loading, startLoad] = useTransition();
  const [sortKey, setSortKey] = useState<SortKey>("amount");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  function loadPage(p: number, key: SortKey, dir: "asc" | "desc") {
    if (!from || !to) {
      setData({ rows: [], total: 0, linkedRefunds: {} });
      setPage(0);
      return;
    }
    startLoad(async () => {
      const result = await getPacingDrillTransactionsPage(
        from,
        to,
        p * PAGE_SIZE,
        PAGE_SIZE,
        profileIds,
        key,
        dir,
      );
      setData(result);
      setPage(p);
    });
  }

  useEffect(() => {
    setData(null);
    setPage(0);
    setSortKey("amount");
    setSortDir("asc");
    loadPage(0, "amount", "asc");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, profileIds?.join(",")]);

  function onSortChange(key: string, dir: "asc" | "desc") {
    if (key !== "date" && key !== "name" && key !== "amount") return;
    setSortKey(key);
    setSortDir(dir);
    loadPage(0, key, dir);
  }

  const txRows: TxRow[] = data ? (data.rows as unknown as TxRow[]) : [];
  const linkedRefunds = data
    ? new Map(Object.entries(data.linkedRefunds).map(([k, v]) => [k, v as unknown as TxRow[]]))
    : undefined;

  const isEmptyRange = !from || !to;
  const subline = isEmptyRange
    ? "No analog period"
    : from === to
      ? from
      : `${from} – ${to}`;

  return (
    <div
      style={{
        background: "#fafbfc",
        padding: "0.5rem 0.75rem 0.75rem",
        borderRadius: 8,
        border: "1px solid #f3f4f6",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          padding: "0.25rem 0.25rem 0.5rem",
        }}
      >
        <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "#1a1f3a" }}>
          {heading}
        </div>
        <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>{subline}</div>
      </div>
      {isEmptyRange ? (
        <div style={{ color: "#9ca3af", padding: "0.5rem 0.25rem", fontSize: "0.85rem" }}>
          No matching dates in this period.
        </div>
      ) : loading && !data ? (
        <div style={{ color: "#999", padding: "0.5rem 0" }}>Loading…</div>
      ) : data ? (
        <div style={{ opacity: loading ? 0.5 : 1, transition: "opacity 0.1s" }}>
          <BulkEditTable
            transactions={txRows}
            accounts={accounts}
            columns={COLUMNS}
            availableTags={availableTags}
            availableCategories={availableCategories}
            profiles={profiles}
            linkedRefunds={linkedRefunds}
            embedded
            controlledSort={{ sortKey, sortDir, onChange: onSortChange }}
            linkName
            linkCategory
            emptyMessage="No transactions on this date."
            toolbarExtras={
              <AccordionPagination
                page={page}
                pageSize={PAGE_SIZE}
                total={data.total}
                loading={loading}
                onPage={(p) => loadPage(p, sortKey, sortDir)}
              />
            }
          />
        </div>
      ) : null}
    </div>
  );
}

export function PacingDrillDown({
  currentFrom,
  currentTo,
  previousFrom,
  previousTo,
  currentLabel,
  previousLabel,
  profileIds,
  accounts,
  availableTags,
  availableCategories,
  profiles,
}: Props) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <SidePanel
        heading={currentLabel}
        from={currentFrom}
        to={currentTo}
        profileIds={profileIds}
        accounts={accounts}
        availableTags={availableTags}
        availableCategories={availableCategories}
        profiles={profiles}
      />
      <SidePanel
        heading={previousLabel}
        from={previousFrom}
        to={previousTo}
        profileIds={profileIds}
        accounts={accounts}
        availableTags={availableTags}
        availableCategories={availableCategories}
        profiles={profiles}
      />
    </div>
  );
}
