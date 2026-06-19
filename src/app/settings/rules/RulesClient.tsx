"use client";

import { useState, useTransition, useId, useEffect } from "react";
import type { Rule, RuleCondition, RuleAction, ConditionField, ConditionOp, ActionType } from "@/lib/types.ts";
import {
  createRule,
  updateRule,
  deleteRule,
  reorderRules,
  previewRuleMatches,
  applyRuleToTransactions,
  type RulePreviewRow,
} from "@/lib/actions.ts";
import { formatMoney } from "@/lib/format.ts";

export interface RuleBuilderOptions {
  categories: string[];
  tags: { id: string; label: string }[];
  accounts: { id: string; label: string }[];
  profiles: { id: string; label: string }[];
  names: string[];
}

const CONDITION_FIELDS: { value: ConditionField; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "canonicalName", label: "Canonical name" },
  { value: "category", label: "Category" },
  { value: "description", label: "Bank's txn description" },
  { value: "tag", label: "Tag" },
  { value: "accountId", label: "Account" },
  { value: "profileId", label: "Profile" },
  { value: "amount", label: "Amount" },
];

const CONDITION_OPS: { value: ConditionOp; label: string }[] = [
  { value: "contains", label: "contains" },
  { value: "eq", label: "equals" },
  { value: "neq", label: "does not equal" },
  { value: "gt", label: ">" },
  { value: "lt", label: "<" },
  { value: "in", label: "is one of" },
];

// Ops that make sense per field
const OPS_BY_FIELD: Record<ConditionField, ConditionOp[]> = {
  name: ["contains", "eq", "neq", "in"],
  canonicalName: ["contains", "eq", "neq", "in"],
  category: ["eq", "neq", "in"],
  description: ["contains", "eq", "neq"],
  tag: ["eq", "neq"],
  accountId: ["eq", "neq"],
  profileId: ["eq", "neq", "in"],
  amount: ["gt", "lt", "eq"],
};

const ACTION_TYPES: { value: ActionType; label: string; hasValue: boolean; hidden?: boolean }[] = [
  { value: "exclude", label: "Exclude from everything", hasValue: false },
  { value: "markOneTime", label: "Mark one-time / anomaly", hasValue: false },
  { value: "setCategory", label: "Set category", hasValue: true },
  { value: "setTags", label: "Set tag", hasValue: true },
  { value: "setCustomName", label: "Set custom name", hasValue: true },
  { value: "setCanonicalName", label: "Set canonical name (and teach alias)", hasValue: true },
  { value: "setProfile", label: "Set profile", hasValue: true },
  // Legacy tag actions — superseded by "Set tag". Hidden from the picker but
  // kept here so existing rules using them still render + evaluate correctly.
  { value: "addTag", label: "Add tag", hasValue: true, hidden: true },
  { value: "removeTag", label: "Remove tag", hasValue: true, hidden: true },
];

function emptyCondition(): RuleCondition {
  return { field: "name", op: "contains", value: "" };
}

function emptyAction(): RuleAction {
  return { type: "exclude" };
}

const inputStyle: React.CSSProperties = {
  padding: "6px 8px",
  border: "1px solid #ddd",
  borderRadius: 4,
  fontSize: 15,
  background: "#fff",
};
const selectStyle: React.CSSProperties = { ...inputStyle, cursor: "pointer" };

// Context-aware value input for a condition
function ConditionValueInput({
  condition,
  onChange,
  options,
}: {
  condition: RuleCondition;
  onChange: (value: string | number) => void;
  options: RuleBuilderOptions;
}) {
  const listId = useId();
  const { field, op } = condition;
  const val = String(condition.value);

  if (field === "category") {
    return (
      <select value={val} onChange={(e) => onChange(e.target.value)} style={{ ...selectStyle, width: 200 }}>
        <option value="">— pick category —</option>
        {options.categories.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
    );
  }

  if (field === "tag") {
    return (
      <select value={val} onChange={(e) => onChange(e.target.value)} style={{ ...selectStyle, width: 200 }}>
        <option value="">— pick tag —</option>
        {options.tags.map((t) => (
          <option key={t.id} value={t.id}>{t.label}</option>
        ))}
      </select>
    );
  }

  if (field === "accountId") {
    return (
      <select value={val} onChange={(e) => onChange(e.target.value)} style={{ ...selectStyle, width: 220 }}>
        <option value="">— pick account —</option>
        {options.accounts.map((a) => (
          <option key={a.id} value={a.id}>{a.label}</option>
        ))}
      </select>
    );
  }

  if (field === "profileId") {
    return (
      <select value={val} onChange={(e) => onChange(e.target.value)} style={{ ...selectStyle, width: 200 }}>
        <option value="">— pick profile —</option>
        {options.profiles.map((p) => (
          <option key={p.id} value={p.id}>{p.label}</option>
        ))}
      </select>
    );
  }

  if (field === "amount") {
    return (
      <input
        type="number"
        value={val}
        onChange={(e) => onChange(Number(e.target.value))}
        placeholder="0"
        style={{ ...inputStyle, width: 100 }}
      />
    );
  }

  // name / description — text input with datalist autocomplete
  const suggestions = field === "name" ? options.names : [];
  if (op === "in") {
    return (
      <input
        value={val}
        onChange={(e) => onChange(e.target.value)}
        placeholder="val1, val2, val3"
        style={{ ...inputStyle, width: 240 }}
      />
    );
  }

  return (
    <>
      <input
        value={val}
        onChange={(e) => onChange(e.target.value)}
        placeholder="value"
        list={suggestions.length ? listId : undefined}
        style={{ ...inputStyle, width: 220 }}
        autoComplete="off"
      />
      {suggestions.length > 0 && (
        <datalist id={listId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
    </>
  );
}

// Context-aware value input for an action
function ActionValueInput({
  action,
  onChange,
  options,
}: {
  action: RuleAction;
  onChange: (value: string) => void;
  options: RuleBuilderOptions;
}) {
  const val = action.value ?? "";

  if (action.type === "setCategory") {
    return (
      <select value={val} onChange={(e) => onChange(e.target.value)} style={{ ...selectStyle, width: 200 }}>
        <option value="">— pick category —</option>
        {options.categories.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
    );
  }

  if (action.type === "setProfile") {
    return (
      <select value={val} onChange={(e) => onChange(e.target.value)} style={{ ...selectStyle, width: 200 }}>
        <option value="">— pick profile —</option>
        {options.profiles.map((p) => (
          <option key={p.id} value={p.id}>{p.label}</option>
        ))}
      </select>
    );
  }

  if (action.type === "setTags" || action.type === "addTag" || action.type === "removeTag") {
    // For "Set tag", an empty value is a real choice: clear all tags.
    const emptyLabel = action.type === "setTags" ? "— no tag —" : "— pick tag —";
    return (
      <select value={val} onChange={(e) => onChange(e.target.value)} style={{ ...selectStyle, width: 200 }}>
        <option value="">{emptyLabel}</option>
        {options.tags.map((t) => (
          <option key={t.id} value={t.id}>{t.label}</option>
        ))}
      </select>
    );
  }

  return (
    <input
      value={val}
      onChange={(e) => onChange(e.target.value)}
      placeholder="value"
      style={{ ...inputStyle, width: 200 }}
    />
  );
}

interface RuleBuilderProps {
  options: RuleBuilderOptions;
  onSave: (name: string, conditions: RuleCondition[], actions: RuleAction[]) => void;
  onCancel: () => void;
  initial?: Rule;
}

function RuleBuilder({ options, onSave, onCancel, initial }: RuleBuilderProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [conditions, setConditions] = useState<RuleCondition[]>(
    initial?.conditions.length ? initial.conditions : [emptyCondition()],
  );
  const [actions, setActions] = useState<RuleAction[]>(
    initial?.actions.length ? initial.actions : [emptyAction()],
  );

  function updateCondition(i: number, patch: Partial<RuleCondition>) {
    setConditions((prev) =>
      prev.map((c, idx) => {
        if (idx !== i) return c;
        const next = { ...c, ...patch };
        // Reset value and clamp op when field changes
        if (patch.field && patch.field !== c.field) {
          next.value = "";
          const allowed = OPS_BY_FIELD[patch.field];
          if (!allowed.includes(next.op)) next.op = allowed[0];
        }
        return next;
      }),
    );
  }

  function updateAction(i: number, patch: Partial<RuleAction>) {
    setActions((prev) => prev.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  }

  const canSave = name.trim().length > 0 && actions.length > 0;

  return (
    <div
      style={{
        background: "#f9f9f9",
        border: "1px solid #ddd",
        borderRadius: 8,
        padding: "20px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        position: "relative",
      }}
    >
      <button
        type="button"
        onClick={onCancel}
        aria-label="Close"
        title="Close without saving"
        style={{
          position: "absolute",
          top: 10,
          right: 12,
          background: "none",
          border: "none",
          fontSize: 22,
          lineHeight: 1,
          cursor: "pointer",
          color: "#888",
          padding: 4,
        }}
      >
        ×
      </button>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label style={{ fontSize: 14, fontWeight: 600, color: "#555" }}>Rule name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Ignore credit card payments"
          style={{ ...inputStyle, width: 320 }}
        />
      </div>

      {/* Conditions */}
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#555", marginBottom: 8 }}>
          CONDITIONS (all must match)
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {conditions.map((cond, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <select
                value={cond.field}
                onChange={(e) => updateCondition(i, { field: e.target.value as ConditionField })}
                style={selectStyle}
              >
                {CONDITION_FIELDS.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
              <select
                value={cond.op}
                onChange={(e) => updateCondition(i, { op: e.target.value as ConditionOp })}
                style={selectStyle}
              >
                {CONDITION_OPS.filter((o) => OPS_BY_FIELD[cond.field].includes(o.value)).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <ConditionValueInput
                condition={cond}
                onChange={(value) => updateCondition(i, { value })}
                options={options}
              />
              <button
                onClick={() => setConditions((prev) => prev.filter((_, idx) => idx !== i))}
                style={{ color: "#999", background: "none", border: "none", cursor: "pointer", fontSize: 20, lineHeight: 1 }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={() => setConditions((prev) => [...prev, emptyCondition()])}
          style={{ marginTop: 8, fontSize: 14, color: "#0070f3", background: "none", border: "none", cursor: "pointer" }}
        >
          + Add condition
        </button>
      </div>

      {/* Actions */}
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#555", marginBottom: 8 }}>
          ACTIONS
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {actions.map((action, i) => {
            const meta = ACTION_TYPES.find((a) => a.value === action.type)!;
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <select
                  value={action.type}
                  onChange={(e) => {
                    const newType = e.target.value as ActionType;
                    const newMeta = ACTION_TYPES.find((a) => a.value === newType)!;
                    updateAction(i, { type: newType, value: newMeta.hasValue ? "" : undefined });
                  }}
                  style={selectStyle}
                >
                  {ACTION_TYPES.filter((a) => !a.hidden || a.value === action.type).map((a) => (
                    <option key={a.value} value={a.value}>{a.label}</option>
                  ))}
                </select>
                {meta.hasValue && (
                  <ActionValueInput
                    action={action}
                    onChange={(value) => updateAction(i, { value })}
                    options={options}
                  />
                )}
                <button
                  onClick={() => setActions((prev) => prev.filter((_, idx) => idx !== i))}
                  style={{ color: "#999", background: "none", border: "none", cursor: "pointer", fontSize: 20, lineHeight: 1 }}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
        <button
          onClick={() => setActions((prev) => [...prev, emptyAction()])}
          style={{ marginTop: 8, fontSize: 14, color: "#0070f3", background: "none", border: "none", cursor: "pointer" }}
        >
          + Add action
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button
          onClick={() => onSave(name.trim(), conditions, actions)}
          disabled={!canSave}
          style={{
            padding: "7px 16px",
            background: canSave ? "#0070f3" : "#ccc",
            color: "#fff",
            border: "none",
            borderRadius: 5,
            cursor: canSave ? "pointer" : "not-allowed",
            fontSize: 15,
            fontWeight: 600,
          }}
        >
          Save rule
        </button>
        <button
          onClick={onCancel}
          style={{
            padding: "7px 16px",
            background: "none",
            border: "1px solid #ddd",
            borderRadius: 5,
            cursor: "pointer",
            fontSize: 15,
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}


function RulePreviewModal({
  rule,
  options,
  onClose,
}: {
  rule: Rule;
  options: RuleBuilderOptions;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<RulePreviewRow[]>([]);
  const [total, setTotal] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    previewRuleMatches(rule.conditions).then((res) => {
      if (!alive) return;
      setRows(res.rows);
      setTotal(res.total);
      setTruncated(res.truncated);
      setSelected(new Set(res.rows.map((r) => r.id)));
      setLoading(false);
    });
    return () => { alive = false; };
  }, [rule.conditions]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === rows.length) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.id)));
  }

  async function handleApply() {
    setApplying(true);
    const result = await applyRuleToTransactions(rule.actions, [...selected]);
    setApplying(false);
    setApplied(result.applied);
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: 10, width: "min(900px, 92vw)",
          maxHeight: "85vh", display: "flex", flexDirection: "column", overflow: "hidden",
        }}
      >
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #eee", display: "flex", alignItems: "center", gap: 12 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700 }}>Preview &amp; apply: {rule.name || "Unnamed rule"}</div>
            <div style={{ fontSize: 13, color: "#666", marginTop: 2 }}>
              {loading
                ? "Loading matches…"
                : `${total.toLocaleString()} transaction${total === 1 ? "" : "s"} match${truncated ? ` (showing first ${rows.length})` : ""}`}
            </div>
          </div>
          <button onClick={onClose} style={{ marginLeft: "auto", background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#888" }}>×</button>
        </div>

        {applied !== null ? (
          <div style={{ padding: 32, textAlign: "center" }}>
            <div style={{ fontSize: 17, fontWeight: 600, color: "#15803d" }}>
              Applied to {applied.toLocaleString()} transaction{applied === 1 ? "" : "s"}.
            </div>
            <button onClick={onClose} style={{ marginTop: 16, padding: "8px 18px", border: "none", borderRadius: 6, background: "#0070f3", color: "#fff", fontWeight: 600, cursor: "pointer" }}>
              Done
            </button>
          </div>
        ) : (
          <>
            <div style={{ overflow: "auto", flex: 1 }}>
              {loading ? (
                <div style={{ padding: 24, color: "#888" }}>Loading…</div>
              ) : rows.length === 0 ? (
                <div style={{ padding: 24, color: "#888" }}>No transactions match these conditions.</div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                  <thead style={{ background: "#f9fafb", position: "sticky", top: 0 }}>
                    <tr>
                      <th style={{ padding: "8px 12px", textAlign: "left", width: 32 }}>
                        <input
                          type="checkbox"
                          checked={selected.size === rows.length && rows.length > 0}
                          ref={(el) => { if (el) el.indeterminate = selected.size > 0 && selected.size < rows.length; }}
                          onChange={toggleAll}
                        />
                      </th>
                      <th style={{ padding: "8px 8px", textAlign: "left", color: "#666", fontWeight: 600 }}>Date</th>
                      <th style={{ padding: "8px 8px", textAlign: "left", color: "#666", fontWeight: 600 }}>Name</th>
                      <th style={{ padding: "8px 8px", textAlign: "left", color: "#666", fontWeight: 600 }}>Category</th>
                      <th style={{ padding: "8px 8px", textAlign: "left", color: "#666", fontWeight: 600 }}>Tags</th>
                      <th style={{ padding: "8px 8px", textAlign: "left", color: "#666", fontWeight: 600 }}>Account</th>
                      <th style={{ padding: "8px 12px", textAlign: "right", color: "#666", fontWeight: 600 }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} style={{ borderTop: "1px solid #f3f4f6" }}>
                        <td style={{ padding: "6px 12px" }}>
                          <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                        </td>
                        <td style={{ padding: "6px 8px", color: "#666", fontVariantNumeric: "tabular-nums" }}>{r.date}</td>
                        <td data-sensitive style={{ padding: "6px 8px" }}>{r.name}</td>
                        <td style={{ padding: "6px 8px", color: "#444" }}>{r.category || <em style={{ color: "#999" }}>Uncategorized</em>}</td>
                        <td style={{ padding: "6px 8px" }}>
                          {r.tags.length === 0 ? (
                            <span style={{ color: "#bbb" }}>—</span>
                          ) : (
                            <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 4 }}>
                              {r.tags.map((t) => {
                                const label = options.tags.find((o) => o.id === t)?.label ?? t;
                                return (
                                  <span key={t} style={{ fontSize: 12, background: "#eef2ff", color: "#3730a3", padding: "1px 6px", borderRadius: 4 }}>
                                    {label}
                                  </span>
                                );
                              })}
                            </span>
                          )}
                        </td>
                        <td data-sensitive style={{ padding: "6px 8px", color: "#666" }}>{r.accountLabel}</td>
                        <td data-sensitive style={{ padding: "6px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: r.amount < 0 ? "#a00" : "#070" }}>
                          {formatMoney(r.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div style={{ padding: "12px 20px", borderTop: "1px solid #eee", display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ fontSize: 14, color: "#666" }}>
                {selected.size} selected
              </div>
              <button onClick={onClose} style={{ marginLeft: "auto", padding: "7px 14px", border: "1px solid #ddd", borderRadius: 5, background: "#fff", cursor: "pointer" }}>
                Cancel
              </button>
              <button
                onClick={handleApply}
                disabled={selected.size === 0 || applying || loading}
                style={{
                  padding: "7px 16px",
                  background: selected.size === 0 || applying || loading ? "#ccc" : "#0070f3",
                  color: "#fff", border: "none", borderRadius: 5,
                  cursor: selected.size === 0 || applying || loading ? "not-allowed" : "pointer",
                  fontSize: 15, fontWeight: 600,
                }}
              >
                {applying ? "Applying…" : `Apply to ${selected.size}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function RuleRow({
  rule,
  options,
  onMove,
  canMoveUp,
  canMoveDown,
}: {
  rule: Rule;
  options: RuleBuilderOptions;
  onMove: (direction: -1 | 1) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleToggle() {
    startTransition(async () => {
      await updateRule(rule.id, { enabled: !rule.enabled });
    });
  }

  function handleDelete() {
    if (!confirm(`Delete rule "${rule.name}"?`)) return;
    startTransition(async () => {
      await deleteRule(rule.id);
    });
  }

  function handleSaveEdit(name: string, conditions: RuleCondition[], actions: RuleAction[]) {
    startTransition(async () => {
      await updateRule(rule.id, { name, conditions, actions });
      setEditing(false);
    });
  }

  // Resolve IDs to human-readable labels for display
  function conditionLabel(c: RuleCondition): string {
    let fieldLabel = CONDITION_FIELDS.find((f) => f.value === c.field)?.label ?? c.field;
    let valLabel = String(c.value);
    if (c.field === "accountId") {
      valLabel = options.accounts.find((a) => a.id === c.value)?.label ?? valLabel;
    } else if (c.field === "profileId") {
      valLabel = options.profiles.find((p) => p.id === c.value)?.label ?? valLabel;
    } else if (c.field === "tag") {
      valLabel = options.tags.find((t) => t.id === c.value)?.label ?? valLabel;
    }
    const opLabel = CONDITION_OPS.find((o) => o.value === c.op)?.label ?? c.op;
    return `${fieldLabel} ${opLabel} "${valLabel}"`;
  }

  function actionLabel(a: RuleAction): string {
    const base = ACTION_TYPES.find((t) => t.value === a.type)?.label ?? a.type;
    // "Set tag" with no value clears all tags.
    if (a.type === "setTags" && !a.value) return "Set tag: (clear all)";
    if (!a.value) return base;
    let valLabel = a.value;
    if (a.type === "addTag" || a.type === "removeTag" || a.type === "setTags") {
      valLabel = options.tags.find((t) => t.id === a.value)?.label ?? valLabel;
    } else if (a.type === "setProfile") {
      valLabel = options.profiles.find((p) => p.id === a.value)?.label ?? valLabel;
    }
    return `${base}: ${valLabel}`;
  }

  if (editing) {
    return (
      <RuleBuilder
        options={options}
        initial={rule}
        onSave={handleSaveEdit}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        padding: "14px 18px",
        background: rule.enabled ? "#fff" : "#fafafa",
        opacity: pending ? 0.6 : 1,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <button
            onClick={() => onMove(-1)}
            disabled={!canMoveUp}
            title="Move up (higher priority)"
            style={{
              background: "none", border: "none", padding: 0, lineHeight: 1, fontSize: 11,
              cursor: canMoveUp ? "pointer" : "not-allowed", color: canMoveUp ? "#666" : "#ccc",
            }}
          >▲</button>
          <button
            onClick={() => onMove(1)}
            disabled={!canMoveDown}
            title="Move down (lower priority)"
            style={{
              background: "none", border: "none", padding: 0, lineHeight: 1, fontSize: 11,
              cursor: canMoveDown ? "pointer" : "not-allowed", color: canMoveDown ? "#666" : "#ccc",
            }}
          >▼</button>
        </div>
        <input
          type="checkbox"
          checked={rule.enabled}
          onChange={handleToggle}
          title={rule.enabled ? "Disable rule" : "Enable rule"}
          style={{ cursor: "pointer", width: 15, height: 15 }}
        />
        <span style={{ fontWeight: 600, fontSize: 16, color: rule.enabled ? "#111" : "#999" }}>
          {rule.name || <em style={{ color: "#aaa" }}>Unnamed rule</em>}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 12 }}>
          <button
            onClick={() => setEditing(true)}
            style={{ fontSize: 14, color: "#0070f3", background: "none", border: "none", cursor: "pointer" }}
          >
            Edit
          </button>
          <button
            onClick={() => setShowPreview(true)}
            style={{ fontSize: 14, color: "#0070f3", background: "none", border: "none", cursor: "pointer" }}
          >
            Preview &amp; apply
          </button>
          <button
            onClick={handleDelete}
            style={{ fontSize: 14, color: "#e53e3e", background: "none", border: "none", cursor: "pointer" }}
          >
            Delete
          </button>
        </div>
      </div>

      {showPreview && (
        <RulePreviewModal rule={rule} options={options} onClose={() => setShowPreview(false)} />
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, paddingLeft: 27 }}>
        {rule.conditions.map((c, i) => (
          <span
            key={i}
            style={{
              fontSize: 14,
              background: "#eff6ff",
              color: "#1d4ed8",
              padding: "2px 8px",
              borderRadius: 4,
            }}
          >
            {conditionLabel(c)}
          </span>
        ))}
        <span style={{ fontSize: 14, color: "#999" }}>→</span>
        {rule.actions.map((a, i) => (
          <span
            key={i}
            style={{
              fontSize: 14,
              background: "#f0fdf4",
              color: "#15803d",
              padding: "2px 8px",
              borderRadius: 4,
            }}
          >
            {actionLabel(a)}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function RulesClient({
  initialRules,
  options,
}: {
  initialRules: Rule[];
  options: RuleBuilderOptions;
}) {
  const [showBuilder, setShowBuilder] = useState(false);
  const [, startTransition] = useTransition();

  function handleCreate(name: string, conditions: RuleCondition[], actions: RuleAction[]) {
    startTransition(async () => {
      await createRule(name, conditions, actions);
      setShowBuilder(false);
    });
  }

  function handleMove(ruleId: string, direction: -1 | 1) {
    const idx = initialRules.findIndex((r) => r.id === ruleId);
    const target = idx + direction;
    if (idx < 0 || target < 0 || target >= initialRules.length) return;
    const reordered = [...initialRules];
    [reordered[idx], reordered[target]] = [reordered[target], reordered[idx]];
    startTransition(async () => {
      await reorderRules(reordered.map((r) => r.id));
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {showBuilder ? (
        <RuleBuilder options={options} onSave={handleCreate} onCancel={() => setShowBuilder(false)} />
      ) : (
        <button
          onClick={() => setShowBuilder(true)}
          style={{
            alignSelf: "flex-start",
            padding: "8px 16px",
            background: "#0070f3",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 15,
            fontWeight: 600,
          }}
        >
          + New rule
        </button>
      )}

      {initialRules.length === 0 && !showBuilder && (
        <p style={{ color: "#777", fontSize: 16, margin: "8px 0" }}>
          No rules yet. Rules let you ignore, re-categorize, or tag transactions automatically.
        </p>
      )}

      {initialRules.map((rule, i) => (
        <RuleRow
          key={rule.id}
          rule={rule}
          options={options}
          onMove={(dir) => handleMove(rule.id, dir)}
          canMoveUp={i > 0}
          canMoveDown={i < initialRules.length - 1}
        />
      ))}
    </div>
  );
}
