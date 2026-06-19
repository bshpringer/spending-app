"use client";

import Link from "next/link";
import React, { useState, useTransition } from "react";
import { bulkUpdateTransactions, bulkDeleteTransactions, type BulkAction } from "@/lib/actions.ts";
import { TransactionEditModal } from "./TransactionEditModal.tsx";
import { formatMoney, formatAccountLabel } from "@/lib/format.ts";
import { usePreferences } from "@/components/PreferencesContext.tsx";

export interface TxRow {
  id: string;
  date: string;
  /** Authorized / swipe date — fallback to `date` when not set. Use this for any aggregation-month filter. */
  originalDate?: string;
  name: string;
  customName?: string;
  canonicalName?: string;
  category: string;
  amount: number;
  note: string;
  tags: string[];
  excluded: boolean;
  oneTime: boolean;
  accountId: string | null;
  profileId?: string;
}

export interface AccountInfo {
  id: string;
  accountName: string;
  customName?: string | null;
  institutionName: string;
  accountNumberLast4: string;
  tags: string[];
}

export interface ColumnDef {
  key: string;
  label: string;
  sortHref?: string;  // if present, header is a sort link
  sortActive?: boolean;
  sortDir?: "asc" | "desc";
}

interface Props {
  transactions: TxRow[];
  accounts: AccountInfo[];
  columns: ColumnDef[];
  availableTags: { id: string; displayName: string }[];
  availableCategories: string[];
  profiles?: { id: string; displayName: string; color?: string }[];
  emptyMessage?: React.ReactNode;
  clientSort?: boolean;
  /**
   * Caller-managed sort. When provided, the table renders header arrows from
   * these values and bubbles click events up via onChange — it does NOT
   * reorder rows itself (the caller is expected to refetch in the requested
   * order). Mutually exclusive with clientSort.
   */
  controlledSort?: {
    sortKey: string | null;
    sortDir: "asc" | "desc";
    onChange: (key: string, dir: "asc" | "desc") => void;
    // Columns the caller can actually sort (defaults to every CLIENT_SORTABLE
    // key). Callers backed by a server action that only supports a subset (e.g.
    // the accordions: date/name/amount, no category) pass that subset so the
    // unsupported header renders as plain text instead of a dead control.
    sortableKeys?: string[];
  };
  toolbarExtras?: React.ReactNode;
  /**
   * Nested refund sub-rows: expenseId → array of linked refund TxRows.
   * When present, each linked refund is rendered as an indented child row
   * directly beneath its expense, and is suppressed from the top-level list.
   */
  linkedRefunds?: Map<string, TxRow[]>;
  // When provided, table uses `table-layout: fixed` with these per-column widths
  // (keyed by ColumnDef.key). Prevents columns from reflowing when the row set
  // changes (e.g. chart-driven filters on the category detail page).
  colWidths?: Record<string, string>;
  // Opt-in: render the name cell as a link to /merchants/<displayName>.
  // Off by default so this table doesn't self-link on /merchants/[name].
  linkName?: boolean;
  // Opt-in: render the category cell as a link to /categories/<name>.
  // Off by default so this table doesn't self-link on /categories/[name].
  linkCategory?: boolean;
  // Opt-in: disable the position:sticky on the toolbar + table headers.
  // Use when the table is rendered inside an accordion / drill-down where the
  // hardcoded `top` offsets meant for the /transactions page layout would
  // cover the first row and leave a gap above the toolbar.
  embedded?: boolean;
  // Controlled "Hide excluded" checkbox. When both are provided, parent owns the
  // state and is expected to refetch server-side (so the page-size stays full).
  // When omitted, the table falls back to local state + client-side row filtering.
  hideExcluded?: boolean;
  onHideExcludedChange?: (next: boolean) => void;
}

type ActionType = "setCategory" | "setCustomName" | "setCanonicalName" | "addTag" | "removeTag" | "exclude" | "unexclude" | "markOneTime" | "unmarkOneTime" | "setProfile" | "delete";

const ACTION_LABELS: Record<ActionType, string> = {
  setCategory: "Set category",
  setCustomName: "Set custom name",
  setCanonicalName: "Set canonical name",
  addTag: "Add tag",
  removeTag: "Remove tag",
  exclude: "Exclude from everything",
  unexclude: "Un-exclude",
  markOneTime: "Mark one-time",
  unmarkOneTime: "Unmark one-time",
  setProfile: "Set profile",
  delete: "Delete",
};

export function clientSortRows(txs: TxRow[], key: string, dir: "asc" | "desc"): TxRow[] {
  const sorted = [...txs].sort((a, b) => {
    let av: string | number;
    let bv: string | number;
    switch (key) {
      case "date": av = a.date; bv = b.date; break;
      case "name": av = (a.customName ?? a.canonicalName ?? a.name).toLowerCase(); bv = (b.customName ?? b.canonicalName ?? b.name).toLowerCase(); break;
      case "category": av = a.category.toLowerCase(); bv = b.category.toLowerCase(); break;
      case "amount": av = a.amount; bv = b.amount; break;
      default: return 0;
    }
    if (av < bv) return -1;
    if (av > bv) return 1;
    return 0;
  });
  return dir === "desc" ? sorted.reverse() : sorted;
}

export function BulkEditTable({
  transactions,
  accounts,
  columns,
  availableTags,
  availableCategories,
  profiles,
  emptyMessage,
  clientSort,
  controlledSort,
  toolbarExtras,
  colWidths,
  linkedRefunds,
  linkName,
  linkCategory,
  embedded,
  hideExcluded: hideExcludedProp,
  onHideExcludedChange,
}: Props) {
  const profileList = profiles ?? [];
  const [bulkMode, setBulkMode] = useState(false);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionType, setActionType] = useState<ActionType>("setCategory");
  const [actionValue, setActionValue] = useState("");
  const [isPending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Uncontrolled hide-excluded checkbox defaults to the global "hide excluded
  // by default" preference (accordion/drill-down tables that don't manage this
  // state themselves). Controlled callers ignore this and own the state.
  const { hideExcludedByDefault } = usePreferences();
  const [hideExcludedLocal, setHideExcludedLocal] = useState(hideExcludedByDefault);

  const isHideExcludedControlled = hideExcludedProp !== undefined && onHideExcludedChange !== undefined;
  const hideExcluded = isHideExcludedControlled ? hideExcludedProp! : hideExcludedLocal;
  const handleHideExcludedChange = (next: boolean) => {
    if (isHideExcludedControlled) onHideExcludedChange!(next);
    else setHideExcludedLocal(next);
  };

  const accountById = new Map(accounts.map((a) => [a.id, a]));

  function toggleClientSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const CLIENT_SORTABLE = new Set(["date", "name", "category", "amount"]);
  // When controlled, the parent has already applied the filter server-side —
  // don't double-filter (which would shrink the page below its target size).
  const visibleTransactions = (!isHideExcludedControlled && hideExcluded)
    ? transactions.filter((t) => !t.excluded)
    : transactions;
  const displayedTransactions =
    clientSort && sortKey ? clientSortRows(visibleTransactions, sortKey, sortDir) : visibleTransactions;

  function enterBulkMode() {
    setSelected(new Set(visibleTransactions.map((t) => t.id)));
    setActionType("setCategory");
    setActionValue(availableCategories[0] ?? "");
    setBulkMode(true);
  }

  function exitBulkMode() {
    setBulkMode(false);
    setSelected(new Set());
    setConfirmDelete(false);
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === visibleTransactions.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(visibleTransactions.map((t) => t.id)));
    }
  }

  function handleActionTypeChange(type: ActionType) {
    setActionType(type);
    setConfirmDelete(false);
    if (type === "setCategory") setActionValue(availableCategories[0] ?? "");
    else if (type === "addTag" || type === "removeTag") setActionValue(availableTags[0]?.id ?? "");
    else if (type === "setProfile") setActionValue(profileList[0]?.id ?? "");
    else setActionValue("");
  }

  function buildAction(): BulkAction | null {
    switch (actionType) {
      case "setCategory":
        return actionValue ? { type: "setCategory", value: actionValue } : null;
      case "setCustomName":
        return { type: "setCustomName", value: actionValue };
      case "setCanonicalName":
        return { type: "setCanonicalName", value: actionValue };
      case "addTag":
        return actionValue ? { type: "addTag", tagId: actionValue } : null;
      case "removeTag":
        return actionValue ? { type: "removeTag", tagId: actionValue } : null;
      case "exclude":
        return { type: "exclude" };
      case "unexclude":
        return { type: "unexclude" };
      case "markOneTime":
        return { type: "markOneTime" };
      case "unmarkOneTime":
        return { type: "unmarkOneTime" };
      case "setProfile":
        return actionValue ? { type: "setProfile", profileId: actionValue } : null;
      case "delete":
        return null;
    }
  }

  function handleApply() {
    if (actionType === "delete") {
      if (!confirmDelete) {
        setConfirmDelete(true);
        return;
      }
      const ids = Array.from(selected);
      if (ids.length === 0) return;
      startTransition(async () => {
        await bulkDeleteTransactions(ids);
        setConfirmDelete(false);
        exitBulkMode();
      });
      return;
    }
    const action = buildAction();
    if (!action || selected.size === 0) return;
    const ids = Array.from(selected);
    startTransition(async () => {
      await bulkUpdateTransactions(ids, action);
      exitBulkMode();
    });
  }

  const needsValue = actionType === "setCategory" || actionType === "addTag" || actionType === "removeTag" || actionType === "setProfile";
  const canApply = selected.size > 0 && (!needsValue || actionValue !== "");

  return (
    <div>
      <div style={embedded ? {
        ...toolbarStyle,
        position: "static",
        top: undefined,
        minHeight: undefined,
        padding: "0.25rem 0.25rem",
        marginBottom: "0.25rem",
        background: "transparent",
        borderBottom: "none",
      } : toolbarStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flex: 1, minWidth: 0 }}>
          {toolbarExtras}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.9rem", cursor: "pointer", whiteSpace: "nowrap" }}>
            <input
              type="checkbox"
              checked={hideExcluded}
              onChange={(e) => handleHideExcludedChange(e.target.checked)}
            />
            Hide excluded
          </label>
        {bulkMode ? (
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.945rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={selected.size === visibleTransactions.length && visibleTransactions.length > 0}
                ref={(el) => {
                  if (el) el.indeterminate = selected.size > 0 && selected.size < visibleTransactions.length;
                }}
                onChange={toggleAll}
              />
              <span style={{ fontWeight: 600 }}>{selected.size} selected</span>
            </label>

            <span style={{ opacity: 0.3 }}>|</span>

            <select
              value={actionType}
              onChange={(e) => handleActionTypeChange(e.target.value as ActionType)}
              style={selectStyle}
            >
              {(Object.keys(ACTION_LABELS) as ActionType[]).map((k) => (
                <option key={k} value={k}>{ACTION_LABELS[k]}</option>
              ))}
            </select>

            {actionType === "setCategory" && (
              <select value={actionValue} onChange={(e) => setActionValue(e.target.value)} style={selectStyle}>
                {availableCategories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            )}

            {(actionType === "setCustomName" || actionType === "setCanonicalName") && (
              <input
                type="text"
                value={actionValue}
                onChange={(e) => setActionValue(e.target.value)}
                placeholder="Leave blank to clear"
                style={{ ...selectStyle, maxWidth: 180 }}
              />
            )}

            {(actionType === "addTag" || actionType === "removeTag") && (
              <select value={actionValue} onChange={(e) => setActionValue(e.target.value)} style={selectStyle}>
                {availableTags.length === 0 && <option value="">No tags</option>}
                {availableTags.map((t) => (
                  <option key={t.id} value={t.id}>{t.displayName}</option>
                ))}
              </select>
            )}

            {actionType === "setProfile" && (
              <select value={actionValue} onChange={(e) => setActionValue(e.target.value)} style={selectStyle}>
                {profileList.length === 0 && <option value="">No profiles</option>}
                {profileList.map((p) => (
                  <option key={p.id} value={p.id}>{p.displayName}</option>
                ))}
              </select>
            )}

            <button
              onClick={handleApply}
              disabled={(!canApply && actionType !== "delete") || selected.size === 0 || isPending}
              style={{
                ...btnStyle,
                background: isPending ? "#aaa" : actionType === "delete" ? "#a00" : "#333",
                color: "#fff",
                border: "none",
                cursor: isPending ? "default" : "pointer",
              }}
            >
              {isPending
                ? actionType === "delete" ? "Deleting…" : "Applying…"
                : actionType === "delete"
                  ? confirmDelete
                    ? `Confirm delete ${selected.size}`
                    : `Delete ${selected.size}`
                  : `Apply to ${selected.size}`}
            </button>

            <button onClick={exitBulkMode} disabled={isPending} style={{ ...btnStyle, cursor: "pointer" }}>
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={enterBulkMode}
            disabled={visibleTransactions.length === 0}
            style={{ ...btnStyle, cursor: visibleTransactions.length > 0 ? "pointer" : "default", opacity: visibleTransactions.length === 0 ? 0.4 : 1 }}
          >
            Bulk edit
          </button>
        )}
        </div>
      </div>

      {displayedTransactions.length === 0 ? (
        emptyMessage ?? null
      ) : (
        <div style={{ border: "1px solid #ddd", borderRadius: 6 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.975rem", tableLayout: colWidths ? "fixed" : "auto" }}>
            {colWidths && (
              <colgroup>
                {bulkMode && <col style={{ width: "40px" }} />}
                {columns.map(({ key }) => (
                  <col key={key} style={colWidths[key] ? { width: colWidths[key] } : undefined} />
                ))}
              </colgroup>
            )}
            <thead>
              <tr style={{ background: "rgba(127,127,127,0.1)" }}>
                {bulkMode && <th style={embedded ? embeddedThStyle : thStyle} />}
                {columns.map(({ key, label, sortHref, sortActive, sortDir: colSortDir }) => {
                  const isClientSortable = clientSort && !sortHref && CLIENT_SORTABLE.has(key);
                  const isClientActive = isClientSortable && sortKey === key;
                  const isControlledSortable =
                    !!controlledSort && !sortHref && CLIENT_SORTABLE.has(key) &&
                    (controlledSort.sortableKeys?.includes(key) ?? true);
                  const isControlledActive =
                    isControlledSortable && controlledSort!.sortKey === key;
                  const onControlledClick = () => {
                    if (!controlledSort) return;
                    const nextDir: "asc" | "desc" =
                      controlledSort.sortKey === key && controlledSort.sortDir === "desc"
                        ? "asc"
                        : controlledSort.sortKey === key && controlledSort.sortDir === "asc"
                          ? "desc"
                          : "desc";
                    controlledSort.onChange(key, nextDir);
                  };
                  return (
                    <th key={key} style={{ ...(embedded ? embeddedThStyle : thStyle), whiteSpace: "nowrap" }}>
                      {sortHref ? (
                        <Link href={sortHref} style={{ textDecoration: "none", color: "inherit" }}>
                          {label}{sortActive ? (colSortDir === "desc" ? " ↓" : " ↑") : " ↕"}
                        </Link>
                      ) : isControlledSortable ? (
                        <button
                          onClick={onControlledClick}
                          style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontWeight: 600, fontSize: "inherit", color: "inherit" }}
                        >
                          {label}{isControlledActive ? (controlledSort!.sortDir === "desc" ? " ↓" : " ↑") : " ↕"}
                        </button>
                      ) : isClientSortable ? (
                        <button
                          onClick={() => toggleClientSort(key)}
                          style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontWeight: 600, fontSize: "inherit", color: "inherit" }}
                        >
                          {label}{isClientActive ? (sortDir === "desc" ? " ↓" : " ↑") : " ↕"}
                        </button>
                      ) : (
                        label
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {displayedTransactions.map((t) => {
                const account = t.accountId ? accountById.get(t.accountId) : undefined;
                const accountLabel = account
                  ? formatAccountLabel(account)
                  : (t.accountId ?? "—");
                const inherited = new Set(account?.tags ?? []);
                const isChecked = selected.has(t.id);
                const childRefunds = linkedRefunds?.get(t.id);

                return (
                  <React.Fragment key={t.id}>
                    <tr
                      key={`row-${t.id}`}
                      style={{
                        borderBottom: childRefunds?.length ? undefined : "1px solid #eee",
                        opacity: t.excluded ? 0.45 : 1,
                        background: bulkMode && isChecked ? "rgba(99,102,241,0.04)" : undefined,
                        cursor: bulkMode ? "pointer" : undefined,
                      }}
                      onClick={bulkMode ? () => toggleRow(t.id) : undefined}
                    >
                      {bulkMode && (
                        <td style={{ padding: "0.5rem 0.5rem 0.5rem 0.75rem" }} onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={isChecked} onChange={() => toggleRow(t.id)} />
                        </td>
                      )}
                      <td style={tdStyle}>{t.date}</td>
                      <td style={tdStyle} data-sensitive>
                        <div style={{ display: "flex", flexDirection: "column" }}>
                          <span>
                            {(() => {
                              // Display uses customName-first (the product label).
                              // Link uses canonicalName-first (the brand bucket) so the /merchants
                              // grouping page resolves to the same group this row belongs to.
                              const merchantKey = t.canonicalName ?? t.customName ?? t.name;
                              const nameNode = t.customName
                                ? <span title={`Original: ${t.name}`}>{t.customName}</span>
                                : t.canonicalName
                                  ? <span title={`Original: ${t.name}`}>{t.canonicalName}</span>
                                  : <>{t.name}</>;
                              return linkName ? (
                                <Link
                                  href={`/merchants/${encodeURIComponent(merchantKey)}`}
                                  onClick={(e) => e.stopPropagation()}
                                  style={{ color: "#0366d6", textDecoration: "none" }}
                                >
                                  {nameNode}
                                </Link>
                              ) : nameNode;
                            })()}
                            {t.excluded && <span style={excludedBadgeStyle}>excluded</span>}
                            {t.oneTime && !t.excluded && <span style={oneTimeBadgeStyle}>one-time</span>}
                            {childRefunds?.length && <span style={refundedBadgeStyle}>↩ {childRefunds.length === 1 ? "1 refund" : `${childRefunds.length} refunds`}</span>}
                          </span>
                          {t.note && (
                            <span style={{
                              fontSize: "0.825rem",
                              color: "#888",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              lineHeight: 1.3,
                              marginTop: 1,
                            }}>
                              {t.note}
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={tdStyle}>
                        {linkCategory ? (
                          <Link
                            href={`/categories/${encodeURIComponent(t.category || "Uncategorized")}`}
                            onClick={(e) => e.stopPropagation()}
                            style={{ color: "#0366d6", textDecoration: "none" }}
                          >
                            {t.category || "Uncategorized"}
                          </Link>
                        ) : (
                          t.category
                        )}
                      </td>
                      <td data-sensitive style={{ ...tdStyle, color: t.amount < 0 ? "#a00" : "#070", whiteSpace: "nowrap" }}>
                        {formatMoney(t.amount)}
                      </td>
                      <td style={{ ...tdStyle, opacity: 0.7 }}>{accountLabel}</td>
                      <td style={tdStyle}>
                        <TagPills tags={t.tags} inherited={inherited} />
                      </td>
                      <td style={tdStyle}>
                        {!bulkMode && (
                          <TransactionEditModal
                            transaction={{ ...t, accountLabel }}
                            availableTags={availableTags}
                            availableCategories={availableCategories}
                            profiles={profileList}
                          />
                        )}
                      </td>
                    </tr>
                    {/* Nested refund child rows — rendered directly beneath their expense */}
                    {childRefunds?.map((r) => {
                      const rAccount = r.accountId ? accountById.get(r.accountId) : undefined;
                      const rAccountLabel = rAccount ? formatAccountLabel(rAccount) : (r.accountId ?? "—");
                      return (
                        <tr
                          key={`refund-${r.id}`}
                          style={{
                            borderBottom: "1px solid #eee",
                            background: "rgba(34,170,85,0.04)",
                            fontSize: "0.895rem",
                            opacity: r.excluded ? 0.45 : 1,
                          }}
                        >
                          {bulkMode && <td />}
                          <td style={{ ...tdStyle, paddingLeft: "2rem", color: "#16a34a", whiteSpace: "nowrap", fontSize: "0.825rem", opacity: 0.75 }}>
                            {r.date}
                          </td>
                          <td style={{ ...tdStyle, paddingLeft: "2rem" }} data-sensitive>
                            <span style={{ color: "#16a34a" }}>↩ refund</span>
                            {" · "}
                            <span style={{ opacity: 0.75 }}>{r.customName ?? r.canonicalName ?? r.name}</span>
                          </td>
                          <td style={{ ...tdStyle, opacity: 0.6 }}>{r.category || "Uncategorized"}</td>
                          <td data-sensitive style={{ ...tdStyle, color: "#16a34a", whiteSpace: "nowrap", fontWeight: 600 }}>
                            {formatMoney(r.amount)}
                          </td>
                          <td style={{ ...tdStyle, opacity: 0.6 }}>{rAccountLabel}</td>
                          <td style={tdStyle} />
                          <td style={tdStyle}>
                            {!bulkMode && (
                              <TransactionEditModal
                                transaction={{ ...r, accountLabel: rAccountLabel }}
                                availableTags={availableTags}
                                availableCategories={availableCategories}
                                profiles={profileList}
                              />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TagPills({ tags, inherited }: { tags: string[]; inherited: Set<string> }) {
  const all = Array.from(new Set([...inherited, ...tags]));
  if (all.length === 0) return null;
  return (
    <span style={{ display: "inline-flex", gap: "0.25rem", flexWrap: "wrap" }}>
      {all.map((t) => {
        const isInherited = inherited.has(t) && !tags.includes(t);
        return (
          <span
            key={t}
            title={isInherited ? "Inherited from account" : undefined}
            style={{
              padding: "0.1rem 0.5rem",
              borderRadius: 999,
              fontSize: "0.875rem",
              border: "1px solid currentColor",
              opacity: isInherited ? 0.55 : 1,
              fontStyle: isInherited ? "italic" : "normal",
            }}
          >
            {t}
          </span>
        );
      })}
    </span>
  );
}


const thStyle: React.CSSProperties = { padding: "0.5rem 0.75rem", textAlign: "left", fontWeight: 600, borderBottom: "1px solid #ddd", position: "sticky", top: 102, background: "#f5f6f7", zIndex: 1 };
const embeddedThStyle: React.CSSProperties = { padding: "0.5rem 0.75rem", textAlign: "left", fontWeight: 600, borderBottom: "1px solid #ddd", background: "#f5f6f7" };
const tdStyle: React.CSSProperties = { padding: "0.5rem 0.75rem" };
const selectStyle: React.CSSProperties = { padding: "0.3rem 0.5rem", fontSize: "0.945rem", border: "1px solid #ccc", borderRadius: 4 };
const btnStyle: React.CSSProperties = { padding: "0.35rem 0.75rem", fontSize: "0.945rem", border: "1px solid #ccc", borderRadius: 4, background: "transparent" };
const toolbarStyle: React.CSSProperties = {
  position: "sticky",
  top: 54,
  zIndex: 2,
  background: "#fff",
  borderBottom: "1px solid #e5e7eb",
  padding: "0.55rem 0.5rem",
  marginBottom: "0.4rem",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "0.75rem",
  minHeight: 48,
  flexWrap: "wrap",
};
const excludedBadgeStyle: React.CSSProperties = {
  marginLeft: "0.4rem", fontSize: "0.825rem", opacity: 0.6,
  border: "1px solid currentColor", borderRadius: 3, padding: "0 0.3rem",
};
const oneTimeBadgeStyle: React.CSSProperties = {
  marginLeft: "0.4rem", fontSize: "0.825rem", color: "#7c6f00",
  border: "1px solid #c4a900", borderRadius: 3, padding: "0 0.3rem",
  background: "rgba(196,169,0,0.06)",
};
const refundedBadgeStyle: React.CSSProperties = {
  marginLeft: "0.4rem", fontSize: "0.75rem", color: "#16a34a",
  border: "1px solid #16a34a", borderRadius: 3, padding: "0 0.3rem",
  background: "rgba(34,170,85,0.07)",
};
