"use client";

import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { TransactionFiltersBar } from "../transactions/TransactionFilters.tsx";
import { MerchantRow } from "./MerchantRow.tsx";
import type { MerchantIndexItem } from "../../lib/aggregations.ts";

export type MerchantSortKey = "net" | "count" | "avg" | "lastSeen" | "name" | "topCategory";

export type NumericOp = "gt" | "gte" | "lt" | "lte" | "eq";

export interface NumericFilterState {
  txnsOp: NumericOp | null;
  txnsVal: number | null;
  netOp: NumericOp | null;
  netVal: number | null;
}

const OP_LABELS: Record<NumericOp, string> = {
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  eq: "=",
};

interface Props {
  items: MerchantIndexItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  sort: MerchantSortKey;
  dir: "asc" | "desc";
  from: string | null;
  to: string | null;
  profileIds: string[] | null;
  accounts: { id: string; label: string }[];
  tags: { id: string; displayName: string }[];
  categoryMeta: { name: string; icon?: string | null; color?: string | null; classification?: "expense" | "income" | "ignored" | null }[];
  availableCategoryNames: string[];
  accountInfos: import("../transactions/BulkEditTable.tsx").AccountInfo[];
  profileOptions: { id: string; displayName: string; color?: string }[];
  numericFilters: NumericFilterState;
}

const COLUMNS: { key: MerchantSortKey; label: string; align?: "right" | "left"; flex: string }[] = [
  { key: "name", label: "Merchant", align: "left", flex: "1 1 0" },
  { key: "count", label: "Txns", align: "right", flex: "0 0 64px" },
  { key: "topCategory", label: "Top Category", align: "left", flex: "0 0 180px" },
  { key: "net", label: "Net Amount", align: "right", flex: "0 0 120px" },
  { key: "avg", label: "Avg/Month", align: "right", flex: "0 0 110px" },
  { key: "lastSeen", label: "Last Seen", align: "right", flex: "0 0 110px" },
];

export default function MerchantsClient({
  items,
  totalCount,
  page,
  pageSize,
  totalPages,
  sort,
  dir,
  from,
  to,
  profileIds,
  accounts,
  tags,
  categoryMeta,
  availableCategoryNames,
  accountInfos,
  profileOptions,
  numericFilters,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function pushParams(patch: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  function clickHeader(col: MerchantSortKey) {
    if (sort === col) {
      pushParams({ dir: dir === "desc" ? "asc" : "desc", page: null });
    } else {
      // Sensible default direction per column. "net" sorts asc so biggest spenders
      // (most-negative values) land on top under the standard sign convention.
      const defaultDir =
        col === "name" || col === "topCategory" || col === "net" ? "asc" : "desc";
      pushParams({ sort: col, dir: defaultDir, page: null });
    }
  }

  const pageStart = (page - 1) * pageSize;
  const pageEnd = Math.min(page * pageSize, totalCount);

  return (
    <main style={{ padding: "2rem", maxWidth: 1400, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
      <div style={{ marginBottom: "1rem", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: "1.625rem", fontWeight: 700, marginBottom: "0.25rem" }}>Merchants</h1>
          <p style={{ color: "#888", fontSize: "1.025rem", margin: 0 }}>
            Spending grouped by merchant. Click a name to see all activity. Click a row chevron to expand transactions inline.
          </p>
        </div>
        <Link
          href="/settings/plaid/reconcile-merchants"
          style={{
            flexShrink: 0,
            padding: "0.4rem 0.9rem",
            border: "1px solid #ccc",
            borderRadius: 4,
            color: "inherit",
            textDecoration: "none",
            fontSize: "0.925rem",
            whiteSpace: "nowrap",
          }}
          title="Group noisy merchant-name variants under one canonical name"
        >
          Clean up merchant names →
        </Link>
      </div>

      <TransactionFiltersBar
        accounts={accounts}
        tags={tags}
        categories={categoryMeta}
        searchPlaceholder="Search merchant name…"
      />

      <NumericFilterRow state={numericFilters} onChange={pushParams} />

      <div style={{ display: "flex", gap: "1.5rem", alignItems: "baseline", margin: "1rem 0", fontSize: "1.025rem", flexWrap: "wrap" }}>
        <span><strong>{totalCount.toLocaleString()}</strong> merchant{totalCount === 1 ? "" : "s"}</span>
        {totalPages > 1 && (
          <span style={{ opacity: 0.7 }}>
            Showing {pageStart + 1}–{pageEnd} of {totalCount.toLocaleString()}
          </span>
        )}
      </div>

      {items.length === 0 ? (
        <p style={{ opacity: 0.7 }}>
          No merchants match.{" "}
          <Link href="/merchants" style={{ textDecoration: "underline" }}>Clear filters</Link>.
        </p>
      ) : (
        <div style={{ background: "white", borderRadius: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.08)", overflow: "hidden" }}>
          {/* Header row */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              padding: "0.6rem 1.1rem",
              fontSize: "0.825rem",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              fontWeight: 700,
              color: "#6b7280",
              background: "#f9fafb",
              borderBottom: "1px solid #e5e7eb",
            }}
          >
            <span style={{ width: 28, flexShrink: 0 }} />
            {COLUMNS.map((c) => {
              const active = sort === c.key;
              const arrow = active ? (dir === "desc" ? " ↓" : " ↑") : "";
              return (
                <button
                  key={c.key}
                  onClick={() => clickHeader(c.key)}
                  style={{
                    flex: c.flex,
                    minWidth: 0,
                    textAlign: c.align ?? "left",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    padding: 0,
                    font: "inherit",
                    fontWeight: 700,
                    color: active ? "#1a1f3a" : "#6b7280",
                    textTransform: "inherit",
                    letterSpacing: "inherit",
                  }}
                >
                  {c.label}
                  {arrow}
                </button>
              );
            })}
            <span style={{ flex: "0 0 100px", textAlign: "right" }}>12mo</span>
          </div>

          {items.map((item) => (
            <MerchantRow
              key={item.merchant}
              item={item}
              from={from}
              to={to}
              profileIds={profileIds}
              availableTags={tags}
              availableCategories={availableCategoryNames}
              accounts={accountInfos}
              profiles={profileOptions}
            />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div style={{ marginTop: "1rem", display: "flex", justifyContent: "center" }}>
          <Pagination page={page} totalPages={totalPages} onGo={(n) => pushParams({ page: n > 1 ? String(n) : null })} />
        </div>
      )}

      <div style={{ marginTop: "1.5rem", fontSize: "0.85rem", color: "#9ca3af" }}>
        Net amount = receipts minus expenses within the selected range (negative = net spend). Avg/Month = Net ÷ months in range.
      </div>
    </main>
  );
}

function Pagination({ page, totalPages, onGo }: { page: number; totalPages: number; onGo: (n: number) => void }) {
  return (
    <nav style={{ display: "flex", gap: "0.5rem", alignItems: "center", fontSize: "0.975rem" }}>
      <button
        type="button"
        onClick={() => onGo(page - 1)}
        disabled={page <= 1}
        style={pageButtonStyle(page <= 1)}
      >
        ← Prev
      </button>
      <span style={{ opacity: 0.7 }}>Page {page} of {totalPages}</span>
      <button
        type="button"
        onClick={() => onGo(page + 1)}
        disabled={page >= totalPages}
        style={pageButtonStyle(page >= totalPages)}
      >
        Next →
      </button>
    </nav>
  );
}

function pageButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "0.35rem 0.7rem",
    border: "1px solid #ccc",
    borderRadius: 4,
    background: "white",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.4 : 1,
    color: "inherit",
    font: "inherit",
  };
}

const OP_OPTIONS: { value: NumericOp; label: string }[] = [
  { value: "gt", label: "> greater than" },
  { value: "gte", label: "≥ at least" },
  { value: "lt", label: "< less than" },
  { value: "lte", label: "≤ at most" },
  { value: "eq", label: "= equals" },
];

function NumericFilterRow({
  state,
  onChange,
}: {
  state: NumericFilterState;
  onChange: (patch: Record<string, string | null>) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: "0.75rem",
        flexWrap: "wrap",
        alignItems: "center",
        margin: "0.6rem 0 0",
        padding: "0.5rem 0.75rem",
        background: "#f9fafb",
        border: "1px solid #e5e7eb",
        borderRadius: 6,
        fontSize: "0.92rem",
      }}
    >
      <span style={{ color: "#6b7280", fontWeight: 600, fontSize: "0.82rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        Column filters
      </span>
      <NumericFilterControl
        label="Txns"
        op={state.txnsOp}
        val={state.txnsVal}
        opKey="txnsOp"
        valKey="txnsVal"
        prefix=""
        onChange={onChange}
      />
      <NumericFilterControl
        label="Net Amount"
        op={state.netOp}
        val={state.netVal}
        opKey="netOp"
        valKey="netVal"
        prefix="$"
        onChange={onChange}
      />
      {(state.txnsOp || state.netOp) && (
        <button
          type="button"
          onClick={() =>
            onChange({ txnsOp: null, txnsVal: null, netOp: null, netVal: null, page: null })
          }
          style={{
            padding: "0.25rem 0.6rem",
            border: "1px solid #ccc",
            borderRadius: 4,
            background: "white",
            cursor: "pointer",
            fontSize: "0.85rem",
            color: "#6b7280",
          }}
        >
          Clear
        </button>
      )}
    </div>
  );
}

function NumericFilterControl({
  label,
  op,
  val,
  opKey,
  valKey,
  prefix,
  onChange,
}: {
  label: string;
  op: NumericOp | null;
  val: number | null;
  opKey: string;
  valKey: string;
  prefix: string;
  onChange: (patch: Record<string, string | null>) => void;
}) {
  const active = op !== null && val !== null;
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ color: "#374151", fontWeight: 500 }}>{label}</span>
      <select
        value={op ?? ""}
        onChange={(e) => {
          const v = e.target.value as NumericOp | "";
          if (v === "") {
            onChange({ [opKey]: null, [valKey]: null, page: null });
          } else {
            onChange({ [opKey]: v, page: null });
          }
        }}
        style={{
          padding: "0.2rem 0.35rem",
          fontSize: "0.9rem",
          border: "1px solid #d1d5db",
          borderRadius: 4,
          background: "white",
          cursor: "pointer",
        }}
      >
        <option value="">any</option>
        {OP_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
        {prefix && (
          <span style={{ position: "absolute", left: 8, color: "#9ca3af", fontSize: "0.9rem", pointerEvents: "none" }}>
            {prefix}
          </span>
        )}
        <input
          type="number"
          inputMode="decimal"
          step="any"
          placeholder="value"
          defaultValue={val ?? ""}
          disabled={op === null}
          onBlur={(e) => {
            const raw = e.target.value.trim();
            if (raw === "") {
              if (val !== null) onChange({ [valKey]: null, page: null });
            } else {
              const n = Number(raw);
              if (Number.isFinite(n) && n !== val) {
                onChange({ [valKey]: String(n), page: null });
              }
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          style={{
            width: 90,
            padding: prefix ? "0.2rem 0.45rem 0.2rem 1.1rem" : "0.2rem 0.45rem",
            fontSize: "0.9rem",
            border: `1px solid ${active ? "#9ca3af" : "#d1d5db"}`,
            borderRadius: 4,
            background: op === null ? "#f3f4f6" : "white",
            fontVariantNumeric: "tabular-nums",
          }}
        />
      </div>
      {active && (
        <span style={{ fontSize: "0.78rem", color: "#1a1f3a", fontWeight: 600 }}>
          {OP_LABELS[op]} {prefix}{val}
        </span>
      )}
    </div>
  );
}
