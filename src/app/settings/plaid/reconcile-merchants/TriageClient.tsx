"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TriageCluster } from "@/lib/merchantTriage.ts";
import { CategoryCombobox } from "@/components/CategoryCombobox.tsx";
import { confirmTriageCluster, ignoreTriageCluster, unignoreTriageCluster } from "./actions.ts";

interface Props {
  clusters: TriageCluster[];
  existingCategories: string[];
  reconciledRows: number;
  unreconciledRows: number;
}

type SizeFilter = 1 | 2 | 5;

export function TriageClient({
  clusters,
  existingCategories,
  reconciledRows,
  unreconciledRows,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyStem, setBusyStem] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [minSize, setMinSize] = useState<SizeFilter>(2);
  const [showIgnored, setShowIgnored] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastConfirm, setLastConfirm] = useState<string | null>(null);
  // Stems resolved this session — hidden immediately, server refresh follows.
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Record<string, { canonical?: string; category?: string }>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const active = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clusters.filter((c) => {
      if (c.dismissed || resolved.has(c.stem)) return false;
      if (c.txnCount < minSize) return false;
      if (!q) return true;
      return (
        c.stem.includes(q) ||
        c.label.toLowerCase().includes(q) ||
        c.rocketPatterns.some((p) => p.toLowerCase().includes(q)) ||
        c.plaidPatterns.some((p) => p.toLowerCase().includes(q))
      );
    });
  }, [clusters, resolved, search, minSize]);

  const ignored = useMemo(
    () => clusters.filter((c) => c.dismissed && !resolved.has(c.stem)),
    [clusters, resolved],
  );

  const totalDone = reconciledRows;
  const totalAll = reconciledRows + unreconciledRows;
  const pct = totalAll === 0 ? 100 : Math.round((totalDone / totalAll) * 100);

  const run = (stem: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    setBusyStem(stem);
    startTransition(async () => {
      const r = await fn();
      setBusyStem(null);
      if (!r.ok) {
        setError(r.error ?? "Unknown error");
        return;
      }
      setResolved((s) => new Set(s).add(stem));
      router.refresh();
    });
  };

  const onConfirm = (c: TriageCluster) => {
    const edit = edits[c.stem] ?? {};
    const canonical = (edit.canonical ?? c.proposedCanonicalName).trim();
    const category = (edit.category ?? c.proposedCategory ?? "").trim();
    run(c.stem, async () => {
      const r = await confirmTriageCluster({
        canonicalName: canonical,
        defaultCategory: category || null,
        rocketPatterns: c.rocketPatterns,
        plaidPatterns: c.plaidPatterns,
      });
      if (r.ok) setLastConfirm(`✓ "${canonical}" written onto ${r.updatedRows} transactions`);
      return r;
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Progress header */}
      <div
        style={{
          border: "1px solid rgba(0,0,0,0.1)",
          borderRadius: 8,
          padding: "0.75rem 1rem",
          background: "#fff",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
          <span>
            <strong>{totalDone.toLocaleString("en-US")}</strong> of{" "}
            {totalAll.toLocaleString("en-US")} transactions reconciled ({pct}%)
          </span>
          <span style={{ opacity: 0.7 }}>
            {active.length} merchant group{active.length === 1 ? "" : "s"} shown ·{" "}
            {ignored.length} ignored
          </span>
        </div>
        <div style={{ height: 8, borderRadius: 4, background: "#e5e7eb", overflow: "hidden" }}>
          <div
            style={{
              width: `${pct}%`,
              height: "100%",
              background: "#16a34a",
              transition: "width 300ms ease",
            }}
          />
        </div>
      </div>

      {/* Toolbar */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="search"
          placeholder="Search merchants…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: "6px 10px",
            fontSize: 14,
            borderRadius: 6,
            border: "1px solid rgba(0,0,0,0.2)",
            minWidth: 240,
          }}
        />
        <div style={{ display: "flex", gap: 4 }}>
          {([2, 5, 1] as SizeFilter[]).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setMinSize(n)}
              style={{
                padding: "5px 10px",
                borderRadius: 999,
                border: "1px solid rgba(0,0,0,0.15)",
                background: minSize === n ? "#1a1f3a" : "#fff",
                color: minSize === n ? "#fff" : "#333",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              {n === 1 ? "All sizes" : `${n}+ txns`}
            </button>
          ))}
        </div>
        {lastConfirm && (
          <span style={{ fontSize: 13, color: "#16a34a", marginLeft: "auto" }}>{lastConfirm}</span>
        )}
      </div>

      {error && <div style={{ color: "#dc2626", fontSize: 13 }}>{error}</div>}

      {/* Cluster list */}
      {active.length === 0 ? (
        <p style={{ fontSize: 14, opacity: 0.7 }}>
          {search || minSize > 1
            ? "No merchant groups match the current search/size filter."
            : "Nothing left to triage — every unignored merchant group is reconciled. 🎉"}
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {active.map((c) => (
            <ClusterCard
              key={c.stem}
              cluster={c}
              edit={edits[c.stem] ?? {}}
              onEdit={(patch) =>
                setEdits((prev) => ({ ...prev, [c.stem]: { ...prev[c.stem], ...patch } }))
              }
              expanded={expanded.has(c.stem)}
              onToggleExpand={() =>
                setExpanded((prev) => {
                  const next = new Set(prev);
                  if (next.has(c.stem)) next.delete(c.stem);
                  else next.add(c.stem);
                  return next;
                })
              }
              busy={pending && busyStem === c.stem}
              disabled={pending}
              categories={existingCategories}
              onConfirm={() => onConfirm(c)}
              onIgnore={() => run(c.stem, () => ignoreTriageCluster(c.stem, c.label))}
            />
          ))}
        </div>
      )}

      {/* Ignored section */}
      {ignored.length > 0 && (
        <div style={{ marginTop: "0.5rem" }}>
          <button
            type="button"
            onClick={() => setShowIgnored((v) => !v)}
            style={{
              background: "transparent",
              border: "none",
              padding: 0,
              fontSize: 14,
              fontWeight: 600,
              color: "#1a1f3a",
              cursor: "pointer",
            }}
          >
            {showIgnored ? "▾" : "▸"} Ignored merchant groups ({ignored.length})
          </button>
          {showIgnored && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
              {ignored.map((c) => (
                <div
                  key={c.stem}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    fontSize: 13,
                    padding: "4px 8px",
                    borderRadius: 6,
                    background: "#f9fafb",
                  }}
                >
                  <span style={{ opacity: 0.6, minWidth: 50, textAlign: "right" }}>
                    {c.txnCount} txn{c.txnCount === 1 ? "" : "s"}
                  </span>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.label}
                  </span>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(c.stem, () => unignoreTriageCluster(c.stem))}
                    style={{
                      fontSize: 12,
                      background: "none",
                      border: "none",
                      color: "#1a1f3a",
                      cursor: "pointer",
                      textDecoration: "underline",
                    }}
                  >
                    Un-ignore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ClusterCard({
  cluster: c,
  edit,
  onEdit,
  expanded,
  onToggleExpand,
  busy,
  disabled,
  categories,
  onConfirm,
  onIgnore,
}: {
  cluster: TriageCluster;
  edit: { canonical?: string; category?: string };
  onEdit: (patch: { canonical?: string; category?: string }) => void;
  expanded: boolean;
  onToggleExpand: () => void;
  busy: boolean;
  disabled: boolean;
  categories: string[];
  onConfirm: () => void;
  onIgnore: () => void;
}) {
  const canonical = edit.canonical ?? c.proposedCanonicalName;
  const category = edit.category ?? c.proposedCategory ?? "";

  return (
    <div
      style={{
        border: "1px solid rgba(0,0,0,0.1)",
        borderRadius: 8,
        background: "#fff",
        padding: "0.6rem 0.9rem",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        opacity: busy ? 0.6 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={onToggleExpand}
          title={expanded ? "Hide transactions" : "Show transactions"}
          style={{
            background: "transparent",
            border: "none",
            padding: 0,
            cursor: "pointer",
            fontSize: 13,
            width: 16,
          }}
        >
          {expanded ? "▾" : "▸"}
        </button>
        <span
          style={{
            padding: "1px 8px",
            borderRadius: 999,
            background: "#eef2ff",
            color: "#3730a3",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {c.txnCount} txn{c.txnCount === 1 ? "" : "s"}
        </span>
        <strong style={{ fontSize: 14 }}>{c.label}</strong>
        {c.variantCount > 1 && (
          <span style={{ fontSize: 12, opacity: 0.6 }}>{c.variantCount} name variants</span>
        )}
        <span style={{ fontSize: 12, opacity: 0.6, marginLeft: "auto", whiteSpace: "nowrap" }}>
          {c.firstDate} → {c.lastDate} · $
          {c.totalAbsAmount.toLocaleString("en-US", { maximumFractionDigits: 0 })} total
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="text"
          value={canonical}
          onChange={(e) => onEdit({ canonical: e.target.value })}
          placeholder="Canonical name"
          style={{
            padding: "5px 8px",
            fontSize: 13,
            borderRadius: 4,
            border: "1px solid rgba(0,0,0,0.2)",
            flex: "1 1 200px",
            minWidth: 160,
          }}
        />
        <div style={{ flex: "1 1 200px", minWidth: 160 }}>
          <CategoryCombobox
            value={category}
            onChange={(v) => onEdit({ category: v })}
            options={categories}
            placeholder="Category for future syncs (optional)"
          />
        </div>
        <button
          type="button"
          disabled={disabled || canonical.trim() === ""}
          onClick={onConfirm}
          style={{
            padding: "6px 14px",
            borderRadius: 6,
            border: "none",
            background: disabled ? "#9ca3af" : "#1a1f3a",
            color: "#fff",
            cursor: disabled ? "not-allowed" : "pointer",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {busy ? "Working…" : "Confirm"}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onIgnore}
          title="Hide this group from triage. Transactions are untouched; reversible from the Ignored section."
          style={{
            padding: "6px 10px",
            borderRadius: 6,
            border: "1px solid rgba(0,0,0,0.15)",
            background: "#fff",
            color: disabled ? "#9ca3af" : "#444",
            cursor: disabled ? "not-allowed" : "pointer",
            fontSize: 13,
          }}
        >
          Ignore
        </button>
      </div>

      {expanded && (
        <div style={{ borderTop: "1px solid rgba(0,0,0,0.06)", paddingTop: 6 }}>
          <table
            style={{ width: "100%", fontSize: 12, borderCollapse: "collapse", tableLayout: "fixed" }}
          >
            <colgroup>
              <col style={{ width: "6rem" }} />
              <col />
              <col style={{ width: "5rem" }} />
              <col style={{ width: "9rem" }} />
              <col style={{ width: "3.5rem" }} />
            </colgroup>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid rgba(0,0,0,0.08)" }}>
                <th style={{ padding: "2px 4px" }}>Date</th>
                <th style={{ padding: "2px 4px" }}>Name</th>
                <th style={{ padding: "2px 4px", textAlign: "right" }}>$</th>
                <th style={{ padding: "2px 4px" }}>Category</th>
                <th style={{ padding: "2px 4px" }}>Src</th>
              </tr>
            </thead>
            <tbody>
              {c.preview.map((r, i) => (
                <tr key={i}>
                  <td style={{ padding: "2px 4px", whiteSpace: "nowrap" }}>{r.date}</td>
                  <td style={{ padding: "2px 4px", overflowWrap: "anywhere" }}>{r.rawName}</td>
                  <td style={{ padding: "2px 4px", textAlign: "right", fontFamily: "monospace" }}>
                    {r.amount.toFixed(2)}
                  </td>
                  <td style={{ padding: "2px 4px", overflowWrap: "anywhere" }}>{r.category || "—"}</td>
                  <td style={{ padding: "2px 4px", opacity: 0.6 }}>{r.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {c.txnCount > c.preview.length && (
            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>
              Showing newest {c.preview.length} of {c.txnCount}.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
