"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import {
  setCategoryClassification,
  getCategoryTransactionsPage,
} from "../../lib/actions.ts";
import { CategoryIconPicker } from "./CategoryIconPicker.tsx";
import type { Category } from "../../lib/types.ts";
import type { CategoryTxPage } from "../../lib/categoryDateRange.ts";
import { BulkEditTable, type AccountInfo, type ColumnDef, type TxRow } from "../transactions/BulkEditTable.tsx";
import { AccordionPagination } from "../transactions/AccordionPagination.tsx";
import { formatMoney } from "../../lib/format.ts";

const CLASSIFICATIONS = [
  { value: "expense", label: "Expense" },
  { value: "income", label: "Income" },
  { value: "ignored", label: "Ignored" },
];

const CLASSIFICATION_COLORS: Record<string, string> = {
  income: "#16a34a",
  expense: "#374151",
  ignored: "#9ca3af",
};

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
  category: Category;
  count: number;
  expense: number;
  income: number;
  from: string | null;
  to: string | null;
  isLast: boolean;
  availableTags: { id: string; displayName: string }[];
  availableCategories: string[];
  profileIds: string[] | null;
  accounts: AccountInfo[];
  profiles?: { id: string; displayName: string; color?: string }[];
}

export default function CategoryRow({ category, count, expense, income, from, to, isLast, availableTags, availableCategories, profileIds, accounts, profiles }: Props) {
  const [classPending, startClassTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [data, setData] = useState<CategoryTxPage | null>(null);
  const [loading, startLoad] = useTransition();
  const [sortKey, setSortKey] = useState<"date" | "name" | "amount">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function loadPage(p: number, key: "date" | "name" | "amount", dir: "asc" | "desc") {
    startLoad(async () => {
      const result = await getCategoryTransactionsPage(category.displayName, from, to, p * PAGE_SIZE, PAGE_SIZE, profileIds, "date", key, dir);
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
  }, [from, to, count, profileIds?.join(",")]);

  function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (next && data === null) loadPage(0, sortKey, sortDir);
  }

  function handleClassification(value: string) {
    startClassTransition(() => setCategoryClassification(category.displayName, value));
  }

  const classColor = CLASSIFICATION_COLORS[category.classification] ?? "#374151";
  const pending = classPending;

  const txRows: TxRow[] = data ? (data.rows as unknown as TxRow[]) : [];
  const linkedRefunds = data
    ? new Map(Object.entries(data.linkedRefunds).map(([k, v]) => [k, v as unknown as TxRow[]]))
    : undefined;

  return (
    <div style={{
      borderBottom: isLast && !open ? "none" : "1px solid #f3f4f6",
      width: "100%",
      minWidth: 0,
    }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          padding: "0.75rem 1.1rem",
          opacity: pending ? 0.6 : 1,
          transition: "opacity 0.15s",
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
            fontSize: "0.825rem",
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

        <CategoryIconPicker category={category} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <Link
            href={`/categories/${encodeURIComponent(category.displayName)}`}
            className="category-name-link"
            style={{
              fontSize: "1.025rem",
              fontWeight: 500,
              color: "#2563eb",
              textDecoration: "none",
              display: "inline-block",
              maxWidth: "100%",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              verticalAlign: "bottom",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
            onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}
          >
            {category.displayName}
          </Link>
        </div>

        <span data-sensitive style={{ fontSize: "0.945rem", fontVariantNumeric: "tabular-nums", display: "flex", gap: "0.6rem", whiteSpace: "nowrap" }}>
          {expense > 0 && <span style={{ color: "#a00" }}>{formatMoney(expense)}</span>}
          {income > 0 && <span style={{ color: "#070" }}>+{formatMoney(income)}</span>}
          {expense === 0 && income === 0 && <span style={{ color: "#ccc" }}>—</span>}
        </span>

        <span style={{ fontSize: "0.875rem", color: "#aaa", minWidth: "3.5rem", textAlign: "right", whiteSpace: "nowrap" }}>
          {count.toLocaleString()} txn{count !== 1 ? "s" : ""}
        </span>

        <select
          value={category.classification}
          onChange={(e) => handleClassification(e.target.value)}
          style={{
            padding: "0.3rem 0.5rem",
            borderRadius: 6,
            border: "1px solid #e5e7eb",
            fontSize: "0.925rem",
            fontWeight: 600,
            color: classColor,
            background: "white",
            cursor: "pointer",
            minWidth: "7rem",
          }}
        >
          {CLASSIFICATIONS.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
          {!CLASSIFICATIONS.find((c) => c.value === category.classification) && (
            <option value={category.classification}>{category.classification}</option>
          )}
        </select>
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
