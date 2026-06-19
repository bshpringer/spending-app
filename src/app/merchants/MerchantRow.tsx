"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { CATEGORY_ICONS } from "../../lib/categoryIcons.ts";
import { Sparkline } from "./Sparkline.tsx";
import { getMerchantTransactionsPage } from "./actions.ts";
import { BulkEditTable, type AccountInfo, type ColumnDef, type TxRow } from "../transactions/BulkEditTable.tsx";
import { AccordionPagination } from "../transactions/AccordionPagination.tsx";
import { formatMoney } from "../../lib/format.ts";
import type { MerchantIndexItem } from "../../lib/aggregations.ts";
import type { CategoryTxPage } from "../../lib/categoryDateRange.ts";

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

interface Props {
  item: MerchantIndexItem;
  from: string | null;
  to: string | null;
  profileIds: string[] | null;
  availableTags: { id: string; displayName: string }[];
  availableCategories: string[];
  accounts: AccountInfo[];
  profiles?: { id: string; displayName: string; color?: string }[];
}

export function MerchantRow({ item, from, to, profileIds, availableTags, availableCategories, accounts, profiles }: Props) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [data, setData] = useState<CategoryTxPage | null>(null);
  const [loading, startLoad] = useTransition();
  const [sortKey, setSortKey] = useState<"date" | "name" | "amount">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function loadPage(p: number, key: "date" | "name" | "amount", dir: "asc" | "desc") {
    startLoad(async () => {
      const result = await getMerchantTransactionsPage(item.merchant, from, to, p * PAGE_SIZE, PAGE_SIZE, profileIds, key, dir);
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

  function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (next && data === null) loadPage(0, sortKey, sortDir);
  }

  const TopIcon = item.topCategoryIcon ? CATEGORY_ICONS[item.topCategoryIcon] : null;
  const merchantHref = `/merchants/${encodeURIComponent(item.merchant)}`;

  const txRows: TxRow[] = data ? (data.rows as unknown as TxRow[]) : [];
  const linkedRefunds = data
    ? new Map(Object.entries(data.linkedRefunds).map(([k, v]) => [k, v as unknown as TxRow[]]))
    : undefined;

  return (
    <div style={{ borderBottom: "1px solid #f3f4f6" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          padding: "0.6rem 1.1rem",
          fontSize: "0.95rem",
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
            border: "none",
            background: "transparent",
            cursor: "pointer",
            color: "#9ca3af",
            fontSize: "0.825rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transform: open ? "rotate(90deg)" : "none",
            transition: "transform 0.15s",
            flexShrink: 0,
            padding: 0,
          }}
        >
          ▶
        </button>

        <div style={{ flex: "1 1 0", minWidth: 0 }}>
          <Link
            href={merchantHref}
            data-sensitive
            style={{
              fontSize: "1rem",
              fontWeight: 500,
              color: "#2563eb",
              textDecoration: "none",
              display: "inline-block",
              maxWidth: "100%",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
            onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}
          >
            {item.merchant}
          </Link>
          {item.firstSeen && (
            <div style={{ fontSize: "0.78rem", color: "#9ca3af", marginTop: 1 }}>
              First seen {item.firstSeen}
            </div>
          )}
        </div>

        <span style={{
          flex: "0 0 64px",
          textAlign: "right",
          color: "#374151",
          fontVariantNumeric: "tabular-nums",
        }}>
          {item.count.toLocaleString()}
        </span>

        <span style={{ flex: "0 0 180px", minWidth: 0, display: "flex", alignItems: "center", gap: 6 }}>
          {item.topCategory ? (
            <Link
              href={`/categories/${encodeURIComponent(item.topCategory)}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                color: "#2563eb",
                textDecoration: "none",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: "0.92rem",
              }}
              title={item.topCategory}
              onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
              onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}
            >
              {TopIcon && (
                <TopIcon size={14} color={item.topCategoryColor ?? "#6b7280"} aria-hidden />
              )}
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {item.topCategory}
              </span>
            </Link>
          ) : (
            <span style={{ color: "#ccc" }}>—</span>
          )}
        </span>

        <span data-sensitive style={{
          flex: "0 0 120px",
          textAlign: "right",
          color: item.net < 0 ? "#a00" : "#070",
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
        }}>
          {formatMoney(item.net)}
        </span>

        <span data-sensitive style={{
          flex: "0 0 110px",
          textAlign: "right",
          color: "#374151",
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
        }}>
          {formatMoney(item.avgPerMonth)}
        </span>

        <span style={{
          flex: "0 0 110px",
          textAlign: "right",
          color: "#6b7280",
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
          fontSize: "0.9rem",
        }}>
          {item.lastSeen ?? "—"}
        </span>

        <span style={{ flex: "0 0 100px", display: "flex", justifyContent: "flex-end" }}>
          <Sparkline values={item.sparkValues} months={item.sparkMonths} width={96} height={22} />
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
                emptyMessage="No transactions in this range."
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
