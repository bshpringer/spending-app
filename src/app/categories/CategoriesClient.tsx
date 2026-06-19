"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import CategoryRow from "./CategoryRow.tsx";
import {
  RANGE_PRESETS,
  RANGE_PRESET_LABELS,
  type RangePreset,
} from "../../lib/categoryDateRange.ts";
import { CategoryCreateModal } from "./CategoryCreateModal.tsx";
import type { Category } from "../../lib/types.ts";

export type SortKey = "spend" | "count" | "name";

export interface CategoryItem {
  category: Category;
  count: number;
  expense: number;
  income: number;
}

interface Props {
  items: CategoryItem[];
  from: string | null;
  to: string | null;
  preset: RangePreset | "custom";
  sortKey: SortKey;
  availableTags: { id: string; displayName: string }[];
  availableCategories: string[];
  profileIds: string[] | null;
  accountInfos: import("../transactions/BulkEditTable.tsx").AccountInfo[];
  profileOptions: { id: string; displayName: string; color?: string }[];
}

const ORDER = ["expense", "income", "ignored"];
const CLASS_LABELS: Record<string, string> = {
  income: "Income",
  expense: "Expense",
  ignored: "Ignored",
};

function sortItems(items: CategoryItem[], key: SortKey, classification: string): CategoryItem[] {
  const arr = [...items];
  if (key === "name") {
    return arr.sort((a, b) => a.category.displayName.localeCompare(b.category.displayName));
  }
  if (key === "count") {
    return arr.sort((a, b) => b.count - a.count || a.category.displayName.localeCompare(b.category.displayName));
  }
  return arr.sort((a, b) => {
    const av = classification === "income" ? a.income : Math.max(a.expense, a.income);
    const bv = classification === "income" ? b.income : Math.max(b.expense, b.income);
    return bv - av || a.category.displayName.localeCompare(b.category.displayName);
  });
}

export default function CategoriesClient({ items, from, to, preset, sortKey, availableTags, availableCategories, profileIds, accountInfos, profileOptions }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  function pushParams(patch: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  function selectPreset(p: RangePreset) {
    pushParams({ range: p, from: null, to: null });
  }

  function changeDate(field: "from" | "to", value: string) {
    pushParams({
      range: "custom",
      from: field === "from" ? (value || null) : (from ?? null),
      to: field === "to" ? (value || null) : (to ?? null),
    });
  }

  function changeSort(value: string) {
    pushParams({ sort: value });
  }

  const byClass: Record<string, CategoryItem[]> = {};
  for (const it of items) (byClass[it.category.classification] ??= []).push(it);
  const classifications = [
    ...ORDER.filter((c) => byClass[c]),
    ...Object.keys(byClass).filter((c) => !ORDER.includes(c)),
  ];

  return (
    <main style={{ maxWidth: 1200, width: "100%", margin: "0 auto", padding: "2rem 1rem" }}>
      <div style={{ marginBottom: "1rem", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: "1.625rem", fontWeight: 700, marginBottom: "0.25rem" }}>Categories</h1>
          <p style={{ color: "#888", fontSize: "1.025rem", margin: 0 }}>
            Set classification, color, and review spending per category. Amounts exclude individually-ignored transactions.
          </p>
        </div>
        <CategoryCreateModal />
      </div>

      {/* Sticky filter row — aligned with the card width below */}
      <div style={{
        position: "sticky",
        top: 54,
        zIndex: 5,
        background: "#eef2f7",
        border: "1px solid #cbd5e1",
        borderRadius: 10,
        padding: "0.6rem 0.9rem",
        marginBottom: "1.25rem",
        boxShadow: "0 2px 10px rgba(15, 23, 42, 0.08)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 4, background: "#f3f4f6", padding: 4, borderRadius: 8 }}>
            {RANGE_PRESETS.map((p) => {
              const active = preset === p;
              return (
                <button
                  key={p}
                  onClick={() => selectPreset(p)}
                  style={{
                    padding: "0.35rem 0.75rem",
                    fontSize: "0.925rem",
                    fontWeight: 600,
                    borderRadius: 6,
                    border: "none",
                    cursor: "pointer",
                    background: active ? "white" : "transparent",
                    color: active ? "#111" : "#666",
                    boxShadow: active ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
                  }}
                >
                  {RANGE_PRESET_LABELS[p]}
                </button>
              );
            })}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.905rem", color: "#666" }}>
            <input
              type="date"
              value={from ?? ""}
              onChange={(e) => changeDate("from", e.target.value)}
              style={dateInputStyle(preset === "custom")}
            />
            <span style={{ opacity: 0.5 }}>→</span>
            <input
              type="date"
              value={to ?? ""}
              onChange={(e) => changeDate("to", e.target.value)}
              style={dateInputStyle(preset === "custom")}
            />
          </div>

          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.925rem", color: "#666" }}>
            <span>Sort by</span>
            <select
              value={sortKey}
              onChange={(e) => changeSort(e.target.value)}
              style={{
                padding: "0.3rem 0.5rem",
                fontSize: "0.925rem",
                borderRadius: 6,
                border: "1px solid #e5e7eb",
                background: "white",
                cursor: "pointer",
              }}
            >
              <option value="spend">Amount</option>
              <option value="count">Transactions</option>
              <option value="name">Name</option>
            </select>
          </div>
        </div>
      </div>

      {items.length === 0 && (
        <p style={{ color: "#aaa" }}>No categories yet — import a CSV to populate.</p>
      )}

      {classifications.map((cls) => {
        const sorted = sortItems(byClass[cls], sortKey, cls);
        return (
          <section key={cls} style={{ marginBottom: "2rem" }}>
            <h2 style={{ fontSize: "0.875rem", fontWeight: 700, letterSpacing: "0.08em", color: "#888", marginBottom: "0.5rem" }}>
              {CLASS_LABELS[cls] ?? cls.toUpperCase()}
            </h2>
            <div style={{ background: "white", borderRadius: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
              {sorted.map((it, i, arr) => (
                <CategoryRow
                  key={it.category.displayName}
                  category={it.category}
                  count={it.count}
                  expense={it.expense}
                  income={it.income}
                  from={from}
                  to={to}
                  isLast={i === arr.length - 1}
                  availableTags={availableTags}
                  availableCategories={availableCategories}
                  profileIds={profileIds}
                  accounts={accountInfos}
                  profiles={profileOptions}
                />
              ))}
            </div>
          </section>
        );
      })}
    </main>
  );
}

function dateInputStyle(active: boolean): React.CSSProperties {
  return {
    padding: "0.3rem 0.4rem",
    fontSize: "0.905rem",
    borderRadius: 6,
    border: `1px solid ${active ? "#9ca3af" : "#e5e7eb"}`,
    background: "white",
    color: "#374151",
    fontVariantNumeric: "tabular-nums",
  };
}
