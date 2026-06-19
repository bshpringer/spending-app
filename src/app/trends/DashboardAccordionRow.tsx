"use client";

import { useState, useTransition, useEffect } from "react";
import Link from "next/link";
import { getCategoryTransactionsPage } from "../../lib/actions.ts";
import type { CategoryTxPage } from "../../lib/categoryDateRange.ts";
import { BulkEditTable, type AccountInfo, type ColumnDef, type TxRow } from "../transactions/BulkEditTable.tsx";
import { AccordionPagination } from "../transactions/AccordionPagination.tsx";
import { CATEGORY_ICONS } from "../../lib/categoryIcons.ts";
import { formatMoney } from "../../lib/format.ts";

interface Props {
  category: string;
  total: number;
  pct: number;
  color: string;
  icon?: string;
  mode: "amount" | "pct";
  isLast: boolean;
  periodFrom: string;
  periodTo: string;
  availableTags: { id: string; displayName: string }[];
  availableCategories: string[];
  profileIds: string[] | null;
  accounts: AccountInfo[];
  profiles?: { id: string; displayName: string; color?: string }[];
}

const PAGE_SIZE = 10;

const ACCORDION_COLUMNS: ColumnDef[] = [
  { key: "date", label: "Date" },
  { key: "name", label: "Name" },
  { key: "category", label: "Category" },
  { key: "amount", label: "Amount" },
  { key: "account", label: "Account" },
  { key: "tags", label: "Tags" },
  { key: "edit", label: "" },
];

export function DashboardAccordionRow({
  category,
  total,
  pct,
  color,
  icon,
  mode,
  isLast,
  periodFrom,
  periodTo,
  availableTags,
  availableCategories,
  profileIds,
  accounts,
  profiles,
}: Props) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [data, setData] = useState<CategoryTxPage | null>(null);
  const [loading, startLoad] = useTransition();
  const [sortKey, setSortKey] = useState<"date" | "name" | "amount">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const from = periodFrom;
  const to = periodTo;

  function loadPage(p: number, key: "date" | "name" | "amount", dir: "asc" | "desc") {
    startLoad(async () => {
      const result = await getCategoryTransactionsPage(category === "Uncategorized" ? "" : category, from, to, p * PAGE_SIZE, PAGE_SIZE, profileIds, "date", key, dir);
      setData(result);
      setPage(p);
    });
  }

  function onSortChange(key: string, dir: "asc" | "desc") {
    if (key !== "date" && key !== "name" && key !== "amount") return;
    setSortKey(key);
    setSortDir(dir);
    loadPage(0, key, dir);
  }

  useEffect(() => {
    setData(null);
    setPage(0);
    setSortKey("date");
    setSortDir("desc");
    if (open) loadPage(0, "date", "desc");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodFrom, periodTo, profileIds?.join(",")]);

  function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (next && data === null) loadPage(0, sortKey, sortDir);
  }

  const categoryName = category || "Uncategorized";
  const IconComp = CATEGORY_ICONS[icon || "Circle"] || CATEGORY_ICONS["Circle"];

  const txRows: TxRow[] = data ? (data.rows as unknown as TxRow[]) : [];
  const linkedRefunds = data
    ? new Map(Object.entries(data.linkedRefunds).map(([k, v]) => [k, v as unknown as TxRow[]]))
    : undefined;

  return (
    <div style={{
      borderBottom: isLast && !open ? "none" : "1px solid #f9fafb",
      width: "100%",
      minWidth: 0,
      overflow: "hidden",
    }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          padding: "0.55rem 0",
        }}
      >
        <button
          type="button"
          onClick={toggleOpen}
          aria-label={open ? "Collapse" : "Expand"}
          aria-expanded={open}
          style={{
            width: 28,
            height: 28,
            marginLeft: -4,
            border: "none",
            background: "transparent",
            cursor: "pointer",
            color: "#9ca3af",
            fontSize: "0.725rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transform: open ? "rotate(90deg)" : "none",
            transition: "transform 0.15s",
            flexShrink: 0,
          }}
        >
          ▶
        </button>

        <div style={{ flex: "0 0 16px", display: "flex", justifyContent: "center", alignItems: "center", color, marginTop: 2 }}>
          <IconComp size={16} strokeWidth={2.5} />
        </div>

        {category && category !== "Uncategorized" ? (
          <Link
            href={`/categories/${encodeURIComponent(category)}`}
            style={{
              flex: 1,
              fontSize: "1.025rem",
              color: "#2563eb",
              textDecoration: "none",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
            onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}
          >
            {categoryName}
          </Link>
        ) : (
          <span style={{ flex: 1, fontSize: "1.025rem", color: "#888", fontStyle: "italic" }}>
            {categoryName}
          </span>
        )}

        <span data-sensitive style={{ fontSize: "0.975rem", fontWeight: 600, color: "#333", minWidth: "4.5rem", textAlign: "right" }}>
          {mode === "amount" ? formatMoney(total) : `${pct.toFixed(1)}%`}
        </span>
      </div>

      {open && (
        <div style={{
          background: "#fafbfc",
          padding: "0.5rem 1.1rem 0.75rem 1.1rem",
          fontSize: "0.945rem",
          borderTop: "1px solid #f3f4f6",
          overflow: "hidden",
        }}>
          {loading && !data && (
            <div style={{ color: "#999", padding: "0.5rem 0" }}>Loading…</div>
          )}
          {data && (
            <div style={{ opacity: loading ? 0.5 : 1, transition: "opacity 0.1s" }}>
              <BulkEditTable
                transactions={txRows}
                accounts={accounts}
                columns={ACCORDION_COLUMNS}
                availableTags={availableTags}
                availableCategories={availableCategories}
                profiles={profiles}
                linkedRefunds={linkedRefunds}
                controlledSort={{ sortKey, sortDir, onChange: onSortChange, sortableKeys: ["date", "name", "amount"] }}
                embedded
                linkName
                linkCategory
                emptyMessage="No transactions found."
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
          )}
        </div>
      )}
    </div>
  );
}
