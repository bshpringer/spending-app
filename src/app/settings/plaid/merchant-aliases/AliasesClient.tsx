"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  MerchantAliasConfidence,
  MerchantAliasReject,
  MerchantAliasSource,
} from "@/lib/types.ts";
import { CategoryCombobox } from "@/components/CategoryCombobox.tsx";
import {
  addSource,
  createAlias,
  deleteAlias,
  removeSource,
  unrejectPair,
  updateAliasFields,
} from "./actions.ts";

export interface AliasView {
  canonicalName: string;
  defaultCategory: string | null;
  confidence: MerchantAliasConfidence;
  sources: MerchantAliasSource[];
  txnCount: number;
}

interface Props {
  aliases: AliasView[];
  rejects: MerchantAliasReject[];
  existingCategories: string[];
}

type SortKey = "txns" | "name";

export function AliasesClient({ aliases, rejects, existingCategories }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("txns");
  const [showRejects, setShowRejects] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Record<string, string>>({});
  const [newSource, setNewSource] = useState<
    Record<string, { pattern: string; source: "rocket" | "plaid" }>
  >({});
  const [draft, setDraft] = useState({
    canonicalName: "",
    category: "",
    pattern: "",
    source: "rocket" as "rocket" | "plaid",
  });
  const [error, setError] = useState<string | null>(null);

  const runAction = (action: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => {
    setError(null);
    startTransition(async () => {
      const r = await action();
      if (!r.ok) setError(r.error ?? "Unknown error");
      else {
        after?.();
        router.refresh();
      }
    });
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? aliases.filter(
          (a) =>
            a.canonicalName.toLowerCase().includes(q) ||
            (a.defaultCategory ?? "").toLowerCase().includes(q) ||
            a.sources.some((s) => s.sourcePattern.toLowerCase().includes(q)),
        )
      : aliases;
    const sorted = [...filtered];
    if (sortKey === "txns") sorted.sort((a, b) => b.txnCount - a.txnCount);
    else sorted.sort((a, b) => a.canonicalName.localeCompare(b.canonicalName));
    return sorted;
  }, [aliases, search, sortKey]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {error && <div style={{ color: "#dc2626", fontSize: 13 }}>{error}</div>}

      {/* Toolbar */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="search"
          placeholder="Search aliases or patterns…"
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
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          style={{ fontSize: 13, padding: "5px 6px", borderRadius: 6 }}
        >
          <option value="txns">Sort: most transactions</option>
          <option value="name">Sort: name A–Z</option>
        </select>
        <span style={{ fontSize: 13, opacity: 0.6 }}>
          {visible.length} of {aliases.length} aliases
        </span>
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          style={{
            marginLeft: "auto",
            padding: "6px 12px",
            borderRadius: 6,
            border: "none",
            background: "#1a1f3a",
            color: "#fff",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {showCreate ? "Cancel" : "+ New alias"}
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div
          style={{
            border: "1px solid rgba(0,0,0,0.1)",
            borderRadius: 8,
            padding: "0.75rem 1rem",
            background: "#f8fafc",
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <input
            type="text"
            placeholder="Canonical name"
            value={draft.canonicalName}
            onChange={(e) => setDraft((d) => ({ ...d, canonicalName: e.target.value }))}
            style={{
              padding: "5px 8px",
              fontSize: 13,
              borderRadius: 4,
              border: "1px solid rgba(0,0,0,0.2)",
              flex: "1 1 180px",
              minWidth: 150,
            }}
          />
          <div style={{ flex: "1 1 180px", minWidth: 150 }}>
            <CategoryCombobox
              value={draft.category}
              onChange={(v) => setDraft((d) => ({ ...d, category: v }))}
              options={existingCategories}
              placeholder="Default category (optional)"
            />
          </div>
          <select
            value={draft.source}
            onChange={(e) =>
              setDraft((d) => ({ ...d, source: e.target.value as "rocket" | "plaid" }))
            }
            style={{ fontSize: 13, padding: "5px 6px" }}
          >
            <option value="rocket">rocket</option>
            <option value="plaid">plaid</option>
          </select>
          <input
            type="text"
            placeholder="First source pattern (optional)"
            value={draft.pattern}
            onChange={(e) => setDraft((d) => ({ ...d, pattern: e.target.value }))}
            style={{
              padding: "5px 8px",
              fontSize: 13,
              borderRadius: 4,
              border: "1px solid rgba(0,0,0,0.2)",
              flex: "1 1 200px",
              minWidth: 160,
            }}
          />
          <button
            type="button"
            disabled={pending || !draft.canonicalName.trim()}
            onClick={() =>
              runAction(
                () =>
                  createAlias({
                    canonicalName: draft.canonicalName,
                    defaultCategory: draft.category || null,
                    sourcePattern: draft.pattern || undefined,
                    source: draft.source,
                  }),
                () => {
                  setDraft({ canonicalName: "", category: "", pattern: "", source: "rocket" });
                  setShowCreate(false);
                },
              )
            }
            style={{
              padding: "6px 12px",
              borderRadius: 6,
              border: "none",
              background: pending ? "#9ca3af" : "#16a34a",
              color: "#fff",
              cursor: pending ? "not-allowed" : "pointer",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Create
          </button>
        </div>
      )}

      {aliases.length === 0 && rejects.length === 0 && (
        <p style={{ opacity: 0.7 }}>
          No aliases yet. Build some via the reconcile page or the &ldquo;+ New alias&rdquo; button.
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {visible.map((a) => {
          const categoryValue = editingCategory[a.canonicalName] ?? (a.defaultCategory ?? "");
          const newSrc = newSource[a.canonicalName] ?? { pattern: "", source: "rocket" as const };
          return (
            <div
              key={a.canonicalName}
              style={{
                border: "1px solid rgba(0,0,0,0.1)",
                borderRadius: 8,
                padding: "0.75rem 1rem",
                background: "#fff",
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>{a.canonicalName}</div>
                  <div style={{ fontSize: 12, opacity: 0.6 }}>
                    {a.txnCount} txn{a.txnCount === 1 ? "" : "s"} · {a.confidence}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    if (!confirm(`Delete alias "${a.canonicalName}"? Transactions keep their stored canonicalName; you can run reconciliation again to re-link.`)) return;
                    runAction(() => deleteAlias(a.canonicalName));
                  }}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 6,
                    border: "1px solid #fecaca",
                    background: "#fff",
                    color: "#b91c1c",
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                >
                  Delete
                </button>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, opacity: 0.75 }}>Default category:</span>
                <div style={{ minWidth: 200, flex: 1 }}>
                  <CategoryCombobox
                    value={categoryValue}
                    onChange={(v) => setEditingCategory((s) => ({ ...s, [a.canonicalName]: v }))}
                    options={existingCategories}
                    placeholder="Search or add..."
                  />
                </div>
                <button
                  type="button"
                  disabled={pending || categoryValue === (a.defaultCategory ?? "")}
                  onClick={() => runAction(() => updateAliasFields(a.canonicalName, categoryValue))}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 6,
                    border: "1px solid rgba(0,0,0,0.15)",
                    background: "#fff",
                    cursor: pending ? "not-allowed" : "pointer",
                    fontSize: 13,
                  }}
                >
                  Save
                </button>
              </div>

              <div>
                <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 4 }}>Source patterns</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {a.sources.map((s) => (
                    <span
                      key={`${s.source}::${s.sourcePattern}`}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        padding: "2px 6px 2px 8px",
                        borderRadius: 999,
                        background: s.source === "plaid" ? "#dbeafe" : "#fce7f3",
                        color: s.source === "plaid" ? "#1e40af" : "#9d174d",
                        fontSize: 12,
                      }}
                    >
                      <strong style={{ fontSize: 11, textTransform: "uppercase" }}>{s.source}</strong>{" "}
                      {s.sourcePattern}
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => runAction(() => removeSource(s.sourcePattern, s.source))}
                        title="Remove pattern"
                        style={{
                          background: "transparent",
                          border: "none",
                          cursor: "pointer",
                          color: "inherit",
                          padding: "0 2px",
                          fontSize: 14,
                          lineHeight: 1,
                        }}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <select
                  value={newSrc.source}
                  onChange={(e) =>
                    setNewSource((s) => ({
                      ...s,
                      [a.canonicalName]: {
                        ...newSrc,
                        source: e.target.value as "rocket" | "plaid",
                      },
                    }))
                  }
                  style={{ fontSize: 13, padding: "3px 6px" }}
                >
                  <option value="rocket">rocket</option>
                  <option value="plaid">plaid</option>
                </select>
                <input
                  type="text"
                  placeholder="Add a source pattern…"
                  value={newSrc.pattern}
                  onChange={(e) =>
                    setNewSource((s) => ({
                      ...s,
                      [a.canonicalName]: { ...newSrc, pattern: e.target.value },
                    }))
                  }
                  style={{
                    padding: "4px 6px",
                    fontSize: 13,
                    borderRadius: 4,
                    border: "1px solid rgba(0,0,0,0.2)",
                    minWidth: 240,
                  }}
                />
                <button
                  type="button"
                  disabled={pending || !newSrc.pattern.trim()}
                  onClick={() => {
                    runAction(() => addSource(a.canonicalName, newSrc.pattern, newSrc.source));
                    setNewSource((s) => ({
                      ...s,
                      [a.canonicalName]: { pattern: "", source: newSrc.source },
                    }));
                  }}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 6,
                    border: "1px solid rgba(0,0,0,0.15)",
                    background: "#fff",
                    cursor: pending ? "not-allowed" : "pointer",
                    fontSize: 13,
                  }}
                >
                  Add
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {rejects.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowRejects((v) => !v)}
            style={{
              background: "transparent",
              border: "none",
              padding: 0,
              fontSize: 15,
              fontWeight: 600,
              color: "#1a1f3a",
              cursor: "pointer",
            }}
          >
            {showRejects ? "▾" : "▸"} Rejected pairings ({rejects.length})
          </button>
          {showRejects && (
            <>
              <p style={{ fontSize: 13, opacity: 0.7, margin: "0.5rem 0" }}>
                Rocket × Plaid pairings you marked as &ldquo;not the same
                merchant&rdquo; in the old wizard. Each side stays eligible to match
                other candidates; only the exact pair is suppressed.
              </p>
              <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: 13 }}>
                {rejects.map((r) => (
                  <li
                    key={`${r.rocketStem}::${r.plaidStem}`}
                    style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}
                  >
                    <span style={{ opacity: 0.65, fontSize: 12 }}>[rocket]</span>
                    <span>{r.rocketLabel}</span>
                    <span style={{ opacity: 0.5 }}>×</span>
                    <span style={{ opacity: 0.65, fontSize: 12 }}>[plaid]</span>
                    <span>{r.plaidLabel}</span>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => runAction(() => unrejectPair(r.rocketStem, r.plaidStem))}
                      style={{
                        fontSize: 12,
                        background: "none",
                        border: "none",
                        color: "#1a1f3a",
                        cursor: "pointer",
                        textDecoration: "underline",
                      }}
                    >
                      un-reject
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
