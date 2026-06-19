"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { parseCsv } from "@/lib/csv-import";
import { formatMoney } from "@/lib/format";
import { DEFAULT_PROFILE_ID } from "@/lib/constants.ts";
import { resolveTags } from "@/lib/evaluate.ts";
import {
  classifyImportRows,
  importParsedCsv,
} from "@/lib/actions";
import type {
  AmbiguousCandidate,
  ClassifiedImportRow,
  CsvParseResult,
  DedupeCollision,
  ImportClassification,
  ImportRowDecision,
  ImportSummary,
  Profile,
} from "@/lib/types";

type EditMap = Record<string, ImportRowDecision>;
type AmbDecision = "skip" | "keep" | "replace";
type AmbDecisionMap = Record<string, AmbDecision>;
type SkipMap = Record<string, boolean>;

export default function ImportPage() {
  const router = useRouter();
  const [parsed, setParsed] = useState<CsvParseResult | null>(null);
  const [classification, setClassification] = useState<ImportClassification | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [classifyPending, startClassifying] = useTransition();
  const [savePending, startSaving] = useTransition();
  const [edits, setEdits] = useState<EditMap>({});
  const [ambDecisions, setAmbDecisions] = useState<AmbDecisionMap>({});
  const [skipNew, setSkipNew] = useState<SkipMap>({});
  const [showDupes, setShowDupes] = useState(false);
  const [editingRow, setEditingRow] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setSummary(null);
    setClassification(null);
    setEdits({});
    setAmbDecisions({});
    setSkipNew({});
    setFileName(file.name);
    try {
      const text = await file.text();
      const result = parseCsv(text);
      setParsed(result);
      startClassifying(async () => {
        try {
          const c = await classifyImportRows(result);
          setClassification(c);
          // Seed edits from rule effects so the visible "post-rule" values are
          // what gets saved unless the user edits further.
          const seeded: EditMap = {};
          for (const row of c.rows) {
            if (row.bucket !== "new") continue;
            const eff = row.ruleEffects;
            if (!eff) continue;
            const dec: ImportRowDecision = {};
            if (eff.category) dec.category = eff.category;
            if (eff.customName) dec.customName = eff.customName;
            if (eff.exclude) dec.excluded = true;
            if (eff.oneTime) dec.oneTime = true;
            if (eff.setTags !== undefined || eff.addTags.length > 0 || eff.removeTags.length > 0) {
              dec.tags = resolveTags(row.parsed.tags, eff);
            }
            if (Object.keys(dec).length > 0) seeded[row.parsed.dedupeKey] = dec;
          }
          setEdits(seeded);
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setParsed(null);
    }
  }

  function handleSave() {
    if (!parsed || !classification) return;
    setError(null);
    const keepAmbiguous: string[] = [];
    const replaceAmbiguous: Record<string, string[]> = {};
    for (const [key, dec] of Object.entries(ambDecisions)) {
      if (dec === "keep") keepAmbiguous.push(key);
      if (dec === "replace") {
        const row = classification.rows.find((r) => r.parsed.dedupeKey === key);
        if (row?.candidates) {
          replaceAmbiguous[key] = row.candidates.map((c) => c.id);
        } else {
          keepAmbiguous.push(key);
        }
      }
    }
    const skipNewList = Object.entries(skipNew)
      .filter(([, v]) => v)
      .map(([k]) => k);
    startSaving(async () => {
      try {
        const result = await importParsedCsv(parsed, {
          keepAmbiguous,
          replaceAmbiguous,
          skipNew: skipNewList,
          overrides: edits,
        });
        setSummary(result);
        if (result.importBatchId && result.newTransactions > 0) {
          router.push(`/transactions?batch=${result.importBatchId}`);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  return (
    <main style={{ padding: "2rem", maxWidth: 1500, margin: "0 auto", width: "100%" }}>
      <h1 style={{ fontSize: "1.625rem", margin: "0 0 0.5rem" }}>Import CSV</h1>
      <p style={{ opacity: 0.7, margin: "0 0 1.25rem", fontSize: "1.025rem" }}>
        Drop a Rocket Money CSV. We&apos;ll match it against the existing database so you
        can see what&apos;s new, what&apos;s already saved, and what looks like a
        near-duplicate worth a closer look — then edit and confirm before anything writes.
      </p>

      <FileDrop onFile={handleFile} />

      {fileName && (
        <p style={{ marginTop: "0.75rem", fontSize: "0.975rem", opacity: 0.7 }}>
          Loaded: <code>{fileName}</code>
          {classifyPending && " — classifying…"}
        </p>
      )}

      {error && (
        <p style={{ marginTop: "1rem", padding: "0.75rem", background: "#fee", color: "#900", borderRadius: 4 }}>
          {error}
        </p>
      )}

      {classification && (
        <ReviewView
          classification={classification}
          edits={edits}
          setEdits={setEdits}
          ambDecisions={ambDecisions}
          setAmbDecisions={setAmbDecisions}
          skipNew={skipNew}
          setSkipNew={setSkipNew}
          showDupes={showDupes}
          setShowDupes={setShowDupes}
          editingRow={editingRow}
          setEditingRow={setEditingRow}
          onSave={handleSave}
          saving={savePending}
          saved={summary !== null}
        />
      )}

      {summary && <SummaryCard summary={summary} />}
    </main>
  );
}

function ReviewView({
  classification,
  edits,
  setEdits,
  ambDecisions,
  setAmbDecisions,
  skipNew,
  setSkipNew,
  showDupes,
  setShowDupes,
  editingRow,
  setEditingRow,
  onSave,
  saving,
  saved,
}: {
  classification: ImportClassification;
  edits: EditMap;
  setEdits: (next: EditMap | ((prev: EditMap) => EditMap)) => void;
  ambDecisions: AmbDecisionMap;
  setAmbDecisions: (next: AmbDecisionMap | ((prev: AmbDecisionMap) => AmbDecisionMap)) => void;
  skipNew: SkipMap;
  setSkipNew: (next: SkipMap | ((prev: SkipMap) => SkipMap)) => void;
  showDupes: boolean;
  setShowDupes: (b: boolean) => void;
  editingRow: string | null;
  setEditingRow: (key: string | null) => void;
  onSave: () => void;
  saving: boolean;
  saved: boolean;
}) {
  const newRows = useMemo(
    () => classification.rows.filter((r) => r.bucket === "new"),
    [classification.rows],
  );
  const ambRows = useMemo(
    () => classification.rows.filter((r) => r.bucket === "ambiguous"),
    [classification.rows],
  );
  const dupRows = useMemo(
    () => classification.rows.filter((r) => r.bucket === "duplicate"),
    [classification.rows],
  );

  // Ambiguous rows the user chose to keep or replace — editable in the New table
  const ambToInsert = useMemo(
    () => ambRows.filter((r) => {
      const dec = ambDecisions[r.parsed.dedupeKey];
      return dec === "keep" || dec === "replace";
    }),
    [ambRows, ambDecisions],
  );

  const skippedNewCount = Object.values(skipNew).filter(Boolean).length;
  const willInsert = newRows.length - skippedNewCount + ambToInsert.length;

  return (
    <section style={{ marginTop: "1.5rem" }}>
      <Header classification={classification} willInsert={willInsert} ambResolved={ambToInsert.length} />

      {classification.newAccountNaturalKeys.length > 0 && (
        <p
          style={{
            marginTop: "0.75rem",
            padding: "0.6rem 0.8rem",
            background: "rgba(0,102,255,0.06)",
            border: "1px solid #b6d4ff",
            borderRadius: 6,
            fontSize: "0.975rem",
          }}
        >
          {classification.newAccountNaturalKeys.length} new account
          {classification.newAccountNaturalKeys.length === 1 ? "" : "s"} will be created on save:{" "}
          <code style={{ fontSize: "0.9rem" }}>
            {classification.newAccountNaturalKeys.join(", ")}
          </code>
        </p>
      )}

      {ambRows.length > 0 && (
        <AmbiguousSection
          rows={ambRows}
          ambDecisions={ambDecisions}
          setAmbDecisions={setAmbDecisions}
        />
      )}

      <NewSection
        rows={newRows}
        ambiguousRows={ambToInsert}
        edits={edits}
        setEdits={setEdits}
        skipNew={skipNew}
        setSkipNew={setSkipNew}
        existingCategories={classification.existingCategories}
        existingTags={classification.existingTags}
        profiles={classification.accessibleProfiles}
        editingRow={editingRow}
        setEditingRow={setEditingRow}
      />

      {classification.collisions.length > 0 && (
        <CollisionsSection collisions={classification.collisions} />
      )}

      <DuplicateSection rows={dupRows} expanded={showDupes} setExpanded={setShowDupes} />

      <div
        style={{
          marginTop: "1.5rem",
          display: "flex",
          gap: "0.75rem",
          alignItems: "center",
          padding: "1rem",
          background: "#fff",
          borderTop: "1px solid #ddd",
          boxShadow: "0 -4px 12px rgba(0,0,0,0.05)",
          borderRadius: "0 0 6px 6px",
          position: "sticky",
          bottom: 0,
          zIndex: 10,
        }}
      >
        <button
          onClick={onSave}
          disabled={saving || saved}
          style={{
            padding: "0.6rem 1.1rem",
            border: "1px solid #2a7",
            color: "#fff",
            background: saved ? "#999" : "#2a7",
            borderRadius: 4,
            cursor: saving || saved ? "default" : "pointer",
            opacity: saving ? 0.7 : 1,
            font: "inherit",
            fontWeight: 600,
          }}
        >
          {saving ? "Saving…" : saved ? "Saved" : `Confirm import (${willInsert} transaction${willInsert === 1 ? "" : "s"})`}
        </button>
        <Link href="/transactions" style={{ fontSize: "1.025rem", opacity: 0.7 }}>
          Cancel
        </Link>
        <span style={{ marginLeft: "auto", fontSize: "0.95rem", opacity: 0.65 }}>
          {dupRows.length} duplicate{dupRows.length === 1 ? "" : "s"} skipped
          {skippedNewCount > 0 && ` · ${skippedNewCount} dropped`}
          {ambRows.length > 0 && ` · ${ambRows.length - ambToInsert.length} ambiguous skipped`}
          {ambToInsert.length > 0 && ` · ${ambToInsert.length} ambiguous kept`}
        </span>
      </div>
    </section>
  );
}

function Header({
  classification,
  willInsert,
  ambResolved,
}: {
  classification: ImportClassification;
  willInsert: number;
  ambResolved: number;
}) {
  const { counts, dateSpan, overlapDays } = classification;
  const days = dateSpan ? daysBetween(dateSpan.from, dateSpan.to) + 1 : 0;
  const unresolvedAmbiguous = counts.ambiguous - ambResolved;

  return (
    <div
      style={{
        padding: "1rem",
        border: "1px solid #ddd",
        borderRadius: 6,
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
        gap: "0.75rem",
      }}
    >
      <Stat
        label="Parsed"
        value={`${counts.parsed}`}
        sub={dateSpan ? `${dateSpan.from} → ${dateSpan.to} · ${days}d` : ""}
      />
      <Stat
        label="Already in DB"
        value={`${counts.duplicate}`}
        sub={`${overlapDays} day${overlapDays === 1 ? "" : "s"} overlap`}
        color="#888"
      />
      {unresolvedAmbiguous > 0 && (
        <Stat
          label="Ambiguous"
          value={`${unresolvedAmbiguous}`}
          sub="review below"
          color="#c80"
        />
      )}
      <Stat label="Will insert" value={`${willInsert}`} sub="after your edits" color="#2a7" />
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div>
      <div style={{ fontSize: "0.8rem", opacity: 0.6, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: "1.6rem", marginTop: "0.15rem", color }}>{value}</div>
      {sub && <div style={{ fontSize: "0.85rem", opacity: 0.65 }}>{sub}</div>}
    </div>
  );
}

function NewSection({
  rows,
  ambiguousRows,
  edits,
  setEdits,
  skipNew,
  setSkipNew,
  existingCategories,
  existingTags,
  profiles,
  editingRow,
  setEditingRow,
}: {
  rows: ClassifiedImportRow[];
  ambiguousRows: ClassifiedImportRow[];
  edits: EditMap;
  setEdits: (next: EditMap | ((prev: EditMap) => EditMap)) => void;
  skipNew: SkipMap;
  setSkipNew: (next: SkipMap | ((prev: SkipMap) => SkipMap)) => void;
  existingCategories: string[];
  existingTags: string[];
  profiles: Profile[];
  editingRow: string | null;
  setEditingRow: (key: string | null) => void;
}) {
  const allRows = useMemo(() => [...rows, ...ambiguousRows], [rows, ambiguousRows]);

  if (allRows.length === 0) {
    return (
      <section style={{ marginTop: "1.5rem" }}>
        <h2 style={{ fontSize: "1.15rem", margin: "0 0 0.5rem" }}>Transactions to import</h2>
        <p style={{ opacity: 0.65, fontSize: "1rem" }}>
          Nothing new in this file. Everything matched existing rows.
        </p>
      </section>
    );
  }

  const editRow = editingRow ? allRows.find((r) => r.parsed.dedupeKey === editingRow) : null;

  return (
    <section style={{ marginTop: "1.5rem" }}>
      <h2 style={{ fontSize: "1.15rem", margin: "0 0 0.5rem" }}>
        Transactions to import ({allRows.length})
      </h2>
      <p style={{ fontSize: "0.95rem", opacity: 0.7, margin: "0 0 0.5rem" }}>
        Edit category, custom name, or profile inline. Click Edit for tags, flags, and notes.
        Rules are pre-applied; you can override their effect here.
      </p>
      <div style={{ border: "1px solid #ddd", borderRadius: 6, overflow: "visible" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.93rem", tableLayout: "fixed" }}>
          <colgroup>
            <col />
            <col style={{ width: 90 }} />
            <col style={{ width: 120 }} />
            <col style={{ width: 160 }} />
            <col style={{ width: 130 }} />
            <col style={{ width: 50 }} />
            <col style={{ width: 50 }} />
          </colgroup>
          <thead>
            <tr style={{ background: "rgba(127,127,127,0.08)" }}>
              {["Transaction", "Amount", "Profile", "Category", "Custom name", "Edit", "Drop"].map((h) => (
                <th key={h} style={{ padding: "0.5rem 0.6rem", textAlign: "left", fontWeight: 600, borderBottom: "1px solid #ddd" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {allRows.map((row) => (
              <NewRow
                key={row.parsed.dedupeKey}
                row={row}
                edit={edits[row.parsed.dedupeKey] ?? {}}
                onChange={(patch) =>
                  setEdits((prev) => ({
                    ...prev,
                    [row.parsed.dedupeKey]: { ...(prev[row.parsed.dedupeKey] ?? {}), ...patch },
                  }))
                }
                skip={!!skipNew[row.parsed.dedupeKey]}
                onSkip={(v) => setSkipNew((prev) => ({ ...prev, [row.parsed.dedupeKey]: v }))}
                onEdit={() => setEditingRow(row.parsed.dedupeKey)}
                existingCategories={existingCategories}
                profiles={profiles}
                isAmbiguous={row.bucket === "ambiguous"}
              />
            ))}
          </tbody>
        </table>
      </div>

      {editRow && (
        <ImportRowEditModal
          row={editRow}
          edit={edits[editingRow!] ?? {}}
          onChange={(patch) =>
            setEdits((prev) => ({
              ...prev,
              [editingRow!]: { ...(prev[editingRow!] ?? {}), ...patch },
            }))
          }
          existingTags={existingTags}
          existingCategories={existingCategories}
          profiles={profiles}
          onClose={() => setEditingRow(null)}
        />
      )}
    </section>
  );
}

function NewRow({
  row,
  edit,
  onChange,
  skip,
  onSkip,
  onEdit,
  existingCategories,
  profiles,
  isAmbiguous,
}: {
  row: ClassifiedImportRow;
  edit: ImportRowDecision;
  onChange: (patch: ImportRowDecision) => void;
  skip: boolean;
  onSkip: (v: boolean) => void;
  onEdit: () => void;
  existingCategories: string[];
  profiles: Profile[];
  isAmbiguous: boolean;
}) {
  const t = row.parsed;
  const ruleApplied = !!row.ruleEffects && (
    row.ruleEffects.category !== undefined
    || row.ruleEffects.customName !== undefined
    || row.ruleEffects.exclude
    || row.ruleEffects.oneTime
    || row.ruleEffects.setTags !== undefined
    || row.ruleEffects.addTags.length > 0
    || row.ruleEffects.removeTags.length > 0
  );

  const profileId = edit.profileId ?? row.defaultProfileId ?? "";
  const hasTags = (edit.tags ?? t.tags).length > 0;
  const hasFlags = !!edit.excluded || !!edit.oneTime;
  const hasNote = !!(edit.note && edit.note.length > 0);

  return (
    <tr style={{ borderBottom: "1px solid #eee", opacity: skip ? 0.4 : 1, verticalAlign: "top", background: isAmbiguous ? "rgba(204,136,0,0.04)" : undefined }}>
      <td style={{ padding: "0.5rem 0.6rem" }}>
        <div style={{ fontSize: "0.8rem", opacity: 0.55 }}>{t.date}</div>
        <div style={{ fontWeight: 500, lineHeight: 1.3, wordBreak: "break-word" }}>{t.name}</div>
        {t.description && (
          <div style={{ fontSize: "0.82rem", opacity: 0.6, lineHeight: 1.3, wordBreak: "break-word" }}>
            {t.description}
          </div>
        )}
        <div style={{ fontSize: "0.8rem", opacity: 0.55, marginTop: "0.2rem" }}>
          {row.accountLabel ?? <em style={{ opacity: 0.7 }}>new account</em>}
        </div>
        {isAmbiguous && (
          <span style={{ fontSize: "0.72rem", padding: "0.05rem 0.35rem", border: "1px solid #c80", borderRadius: 999, color: "#c80" }}>
            ambiguous
          </span>
        )}
        {ruleApplied && (
          <span style={{ fontSize: "0.72rem", padding: "0.05rem 0.35rem", border: "1px solid #06f", borderRadius: 999, color: "#06f", marginLeft: 4 }}>
            rule
          </span>
        )}
      </td>
      <td style={{ padding: "0.5rem 0.6rem", whiteSpace: "nowrap", color: t.amount < 0 ? "#a00" : "#070", fontVariantNumeric: "tabular-nums" }}>
        {formatMoney(t.amount)}
      </td>
      <td style={{ padding: "0.5rem 0.6rem" }}>
        {profiles.length > 0 ? (
          <select
            value={profileId}
            onChange={(e) => onChange({ profileId: e.target.value })}
            disabled={skip}
            style={{ font: "inherit", fontSize: "0.85rem", padding: "0.2rem 0.25rem", border: "1px solid #ccc", borderRadius: 3, background: "#fff", width: "100%" }}
          >
            {!row.defaultProfileId && profileId === "" && <option value="">(default)</option>}
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>{p.displayName}</option>
            ))}
          </select>
        ) : (
          <span style={{ fontSize: "0.85rem" }}>{profiles.find((p) => p.id === profileId)?.displayName ?? profileId}</span>
        )}
      </td>
      <td style={{ padding: "0.5rem 0.6rem" }}>
        <Combobox
          value={edit.category ?? t.category}
          options={existingCategories}
          placeholder="Uncategorized"
          disabled={skip}
          onChange={(v) => onChange({ category: v })}
        />
      </td>
      <td style={{ padding: "0.5rem 0.6rem" }}>
        <input
          type="text"
          value={edit.customName ?? ""}
          onChange={(e) => onChange({ customName: e.target.value })}
          disabled={skip}
          style={inputStyle}
          placeholder="—"
        />
      </td>
      <td style={{ padding: "0.5rem 0.6rem", textAlign: "center" }}>
        <button
          type="button"
          onClick={onEdit}
          disabled={skip}
          style={{
            background: "transparent",
            border: "1px solid #ccc",
            borderRadius: 3,
            padding: "0.15rem 0.4rem",
            cursor: skip ? "default" : "pointer",
            font: "inherit",
            fontSize: "0.8rem",
            color: (hasTags || hasFlags || hasNote) ? "#06f" : undefined,
          }}
        >
          {(hasTags || hasFlags || hasNote) ? "Edit ●" : "Edit"}
        </button>
      </td>
      <td style={{ padding: "0.5rem 0.6rem", textAlign: "center" }}>
        <input
          type="checkbox"
          checked={skip}
          onChange={(e) => onSkip(e.target.checked)}
          aria-label="Drop from import"
        />
      </td>
    </tr>
  );
}

function AmbiguousSection({
  rows,
  ambDecisions,
  setAmbDecisions,
}: {
  rows: ClassifiedImportRow[];
  ambDecisions: AmbDecisionMap;
  setAmbDecisions: (next: AmbDecisionMap | ((prev: AmbDecisionMap) => AmbDecisionMap)) => void;
}) {
  return (
    <section style={{ marginTop: "1.5rem" }}>
      <h2 style={{ fontSize: "1.15rem", margin: "0 0 0.5rem", color: "#c80" }}>
        Ambiguous ({rows.length})
      </h2>
      <p style={{ fontSize: "0.95rem", opacity: 0.75, margin: "0 0 0.75rem" }}>
        Same account and amount as an existing row, with either matching statement description
        or a date within ±7 days. Could be the same charge re-listed (Rocket Money&apos;s pending → posted
        churn), or a real second charge. <strong>Default: skip.</strong>
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {rows.map((row) => (
          <AmbiguousRow
            key={row.parsed.dedupeKey}
            row={row}
            decision={ambDecisions[row.parsed.dedupeKey] ?? "skip"}
            onDecision={(d) =>
              setAmbDecisions((prev) => ({ ...prev, [row.parsed.dedupeKey]: d }))
            }
          />
        ))}
      </div>
    </section>
  );
}

function AmbiguousRow({
  row,
  decision,
  onDecision,
}: {
  row: ClassifiedImportRow;
  decision: AmbDecision;
  onDecision: (d: AmbDecision) => void;
}) {
  const t = row.parsed;
  const borderColor = decision === "skip" ? "#e6c080" : decision === "keep" ? "#2a7" : "#c44";
  const bgColor = decision === "skip" ? "rgba(204,136,0,0.04)" : decision === "keep" ? "rgba(34,170,85,0.04)" : "rgba(204,68,68,0.04)";
  const labels: Record<AmbDecision, string> = { skip: "Skip (default)", keep: "Keep both", replace: "Replace existing" };

  return (
    <div style={{ border: `1px solid ${borderColor}`, borderRadius: 6, padding: "0.75rem", background: bgColor }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem", flexWrap: "wrap" }}>
        <strong style={{ fontSize: "0.95rem" }}>
          {t.originalDate} · {formatMoney(t.amount)} · {t.name}
        </strong>
        {row.accountLabel && (
          <span style={{ fontSize: "0.85rem", opacity: 0.7 }}>{row.accountLabel}</span>
        )}
        {(row.ambiguousReasons ?? []).map((r) => (
          <span key={r} style={{ fontSize: "0.78rem", padding: "0.05rem 0.4rem", border: "1px solid #c80", borderRadius: 999, color: "#c80" }}>
            {r}
          </span>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", gap: "0.75rem", fontSize: "0.9rem" }}>
          {(["skip", "keep", "replace"] as AmbDecision[]).map((d) => (
            <label key={d} style={{ cursor: "pointer", color: decision === d ? borderColor : undefined, fontWeight: decision === d ? 600 : 400 }}>
              <input type="radio" name={`amb-${t.dedupeKey}`} checked={decision === d} onChange={() => onDecision(d)} style={{ marginRight: 3 }} />
              {labels[d]}
            </label>
          ))}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", fontSize: "0.92rem" }}>
        <div style={{ border: "1px solid #ddd", borderRadius: 4, padding: "0.5rem", background: "#fff" }}>
          <div style={{ fontSize: "0.78rem", opacity: 0.6, textTransform: "uppercase", marginBottom: "0.3rem" }}>Incoming row</div>
          <Field label="Name" value={t.name} />
          <Field label="Description" value={t.description} />
          <Field label="Original date" value={t.originalDate} />
          <Field label="Category" value={t.category || "—"} />
        </div>
        <div>
          <div style={{ fontSize: "0.78rem", opacity: 0.6, textTransform: "uppercase", marginBottom: "0.3rem" }}>
            Existing in DB ({row.candidates?.length ?? 0})
          </div>
          {(row.candidates ?? []).map((c) => (
            <CandidateCard key={c.id} c={c} />
          ))}
        </div>
      </div>
      {decision !== "skip" && (
        <div style={{ marginTop: "0.5rem", fontSize: "0.85rem", color: decision === "replace" ? "#c44" : "#2a7", fontWeight: 500 }}>
          {decision === "replace"
            ? `↻ Will delete ${row.candidates?.length ?? 0} existing row(s) and insert this one. Editable below.`
            : "✓ Will insert alongside existing. Editable below."}
        </div>
      )}
    </div>
  );
}

function CandidateCard({ c }: { c: AmbiguousCandidate }) {
  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 4, padding: "0.5rem", background: "#fff", marginBottom: "0.4rem" }}>
      <Field label="Name" value={c.customName ?? c.name} />
      <Field label="Description" value={c.description} />
      <Field label="Original date" value={c.originalDate} />
      <Field label="Category" value={c.category || "—"} />
      <Field label="Note" value={c.note || "—"} />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: "0.4rem", fontSize: "0.92rem", lineHeight: 1.4 }}>
      <span style={{ opacity: 0.55, minWidth: 100 }}>{label}</span>
      <span style={{ wordBreak: "break-word" }}>{value}</span>
    </div>
  );
}

function CollisionsSection({ collisions }: { collisions: DedupeCollision[] }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section style={{ marginTop: "1.5rem" }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          background: "transparent",
          border: "none",
          color: "#c80",
          font: "inherit",
          cursor: "pointer",
          padding: 0,
          fontSize: "1.15rem",
          fontWeight: 600,
        }}
      >
        {expanded ? "▾" : "▸"} Within-file repeats ({collisions.length}) — all will save
      </button>
      <p style={{ fontSize: "0.92rem", opacity: 0.7, margin: "0.25rem 0 0.5rem" }}>
        Multiple rows in this CSV share the same date, account, amount, name, and description.
        Rocket Money sometimes double-lists a charge — these all save with a stable <code>#N</code>
        {" "}suffix so nothing collapses. If you spot a real double-charge here, you can delete
        the extras after import.
      </p>
      {expanded && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem",
          }}
        >
          {collisions.map((c) => (
            <div
              key={c.dedupeKey}
              style={{ border: "1px solid #e6c080", borderRadius: 6, padding: "0.5rem", background: "rgba(204,136,0,0.04)" }}
            >
              <div style={{ fontSize: "0.85rem", fontFamily: "monospace", opacity: 0.65, marginBottom: "0.3rem", wordBreak: "break-all" }}>
                {c.dedupeKey}
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
                <thead>
                  <tr style={{ background: "rgba(127,127,127,0.08)" }}>
                    {["Date", "Name", "Amount", "Category", "Description"].map((h) => (
                      <th key={h} style={{ padding: "0.3rem 0.5rem", textAlign: "left", borderBottom: "1px solid #ddd" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {c.rows.map((r, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #f0f0f0" }}>
                      <td style={{ padding: "0.3rem 0.5rem" }}>{r.date}</td>
                      <td style={{ padding: "0.3rem 0.5rem" }}>{r.name}</td>
                      <td style={{ padding: "0.3rem 0.5rem", color: r.amount < 0 ? "#a00" : "#070", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                        {formatMoney(r.amount)}
                      </td>
                      <td style={{ padding: "0.3rem 0.5rem" }}>{r.category}</td>
                      <td style={{ padding: "0.3rem 0.5rem", opacity: 0.75 }}>{r.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function DuplicateSection({
  rows,
  expanded,
  setExpanded,
}: {
  rows: ClassifiedImportRow[];
  expanded: boolean;
  setExpanded: (b: boolean) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <section style={{ marginTop: "1.5rem" }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          background: "transparent",
          border: "none",
          color: "inherit",
          font: "inherit",
          cursor: "pointer",
          padding: 0,
          fontSize: "1.15rem",
          fontWeight: 600,
        }}
      >
        {expanded ? "▾" : "▸"} Already in DB ({rows.length}) — will be skipped
      </button>
      {expanded && (
        <div
          style={{
            marginTop: "0.5rem",
            border: "1px solid #ddd",
            borderRadius: 6,
            maxHeight: 400,
            overflowY: "auto",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
            <thead>
              <tr style={{ background: "rgba(127,127,127,0.08)", position: "sticky", top: 0 }}>
                {["Date", "Name", "Amount", "Category", "Description"].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: "0.4rem 0.6rem",
                      textAlign: "left",
                      fontWeight: 600,
                      borderBottom: "1px solid #ddd",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.parsed.dedupeKey} style={{ borderBottom: "1px solid #eee", opacity: 0.7 }}>
                  <td style={{ padding: "0.35rem 0.6rem", whiteSpace: "nowrap" }}>{r.parsed.date}</td>
                  <td style={{ padding: "0.35rem 0.6rem" }}>{r.parsed.name}</td>
                  <td style={{ padding: "0.35rem 0.6rem", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                    {formatMoney(r.parsed.amount)}
                  </td>
                  <td style={{ padding: "0.35rem 0.6rem" }}>{r.parsed.category}</td>
                  <td style={{ padding: "0.35rem 0.6rem", opacity: 0.75 }}>{r.parsed.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SummaryCard({ summary }: { summary: ImportSummary }) {
  return (
    <section
      style={{
        marginTop: "1.5rem",
        padding: "1rem",
        border: "1px solid #2a7",
        background: "rgba(34,170,85,0.08)",
        borderRadius: 6,
      }}
    >
      <h2 style={{ fontSize: "1.125rem", marginTop: 0, marginBottom: "0.5rem" }}>Import complete</h2>
      <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "1.025rem" }}>
        <li>{summary.newAccounts} new account(s) created</li>
        <li>{summary.newTags} new tag(s) created</li>
        <li>{summary.newTransactions} new transaction(s) added</li>
        <li>{summary.matchedExisting} existing transaction(s) matched and skipped</li>
      </ul>
    </section>
  );
}

function FileDrop({ onFile }: { onFile: (file: File) => void }) {
  const [isDragging, setIsDragging] = useState(false);
  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) onFile(file);
      }}
      style={{
        display: "block",
        padding: "2rem",
        border: `2px dashed ${isDragging ? "#06f" : "#888"}`,
        borderRadius: 8,
        textAlign: "center",
        cursor: "pointer",
        background: isDragging ? "rgba(0,102,255,0.05)" : "transparent",
      }}
    >
      <p>Drop a CSV here, or click to choose a file</p>
      <input
        type="file"
        accept=".csv,text/csv"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
        }}
      />
    </label>
  );
}

/**
 * Lightweight combobox: text input + chevron. Clicking the chevron always shows
 * the full option list regardless of typed text. Typing filters. Free-text entry
 * is allowed (`+ Use "foo"` row when input doesn't match any option).
 */
function Combobox({
  value,
  onChange,
  options,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setFilter(null);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  const filtered = useMemo(() => {
    if (filter === null || filter === "") return options;
    const f = filter.toLowerCase();
    return options.filter((o) => o.toLowerCase().includes(f));
  }, [filter, options]);

  const displayed = open && filter !== null ? filter : value;
  const showCreate =
    filter !== null && filter.trim().length > 0 && !options.some((o) => o.toLowerCase() === filter.trim().toLowerCase());

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <div
        style={{
          display: "flex",
          border: "1px solid #ccc",
          borderRadius: 3,
          background: disabled ? "#f5f5f5" : "#fff",
        }}
      >
        <input
          type="text"
          value={displayed}
          onChange={(e) => {
            const v = e.target.value;
            setFilter(v);
            setOpen(true);
            onChange(v);
          }}
          onFocus={() => {
            setFilter("");
            setOpen(true);
          }}
          disabled={disabled}
          placeholder={placeholder}
          style={{
            flex: 1,
            padding: "0.2rem 0.25rem",
            border: "none",
            outline: "none",
            font: "inherit",
            fontSize: "0.85rem",
            background: "transparent",
            minWidth: 0,
          }}
        />
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            if (disabled) return;
            if (open) {
              setOpen(false);
              setFilter(null);
            } else {
              setFilter("");
              setOpen(true);
            }
          }}
          disabled={disabled}
          aria-label="Toggle list"
          style={{
            background: "transparent",
            border: "none",
            padding: "0 0.45rem",
            cursor: disabled ? "default" : "pointer",
            color: "inherit",
            font: "inherit",
          }}
        >
          ▾
        </button>
      </div>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 50,
            marginTop: 2,
            background: "#fff",
            border: "1px solid #ccc",
            borderRadius: 4,
            maxHeight: 240,
            overflowY: "auto",
            boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
          }}
        >
          {showCreate && (
            <div
              onMouseDown={(e) => {
                e.preventDefault();
                const v = filter!.trim();
                onChange(v);
                setOpen(false);
                setFilter(null);
              }}
              style={{
                padding: "0.4rem 0.6rem",
                cursor: "pointer",
                fontSize: "0.9rem",
                borderBottom: "1px solid #eee",
                color: "#06f",
              }}
            >
              + Use “{filter!.trim()}”
            </div>
          )}
          {filtered.length === 0 && !showCreate && (
            <div style={{ padding: "0.4rem 0.6rem", opacity: 0.5, fontSize: "0.9rem" }}>(no options)</div>
          )}
          {filtered.map((opt) => (
            <div
              key={opt}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(opt);
                setOpen(false);
                setFilter(null);
              }}
              style={{
                padding: "0.4rem 0.6rem",
                cursor: "pointer",
                fontSize: "0.9rem",
                background: opt === value ? "rgba(0,102,255,0.08)" : "transparent",
              }}
            >
              {opt}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Multi-select tag picker: chip pills + a dedicated input/dropdown to add.
 * Only commits a tag when the user selects from the dropdown, clicks "+ Use",
 * or presses Enter — never on every keystroke (which the generic Combobox
 * would do via onChange).
 */
function TagPicker({
  value,
  options,
  onChange,
  disabled,
}: {
  value: string[];
  options: string[];
  onChange: (v: string[]) => void;
  disabled?: boolean;
}) {
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  const remaining = useMemo(
    () => options.filter((o) => !value.some((v) => v.toLowerCase() === o.toLowerCase())),
    [options, value],
  );

  const filtered = useMemo(() => {
    if (!input) return remaining;
    const q = input.toLowerCase();
    return remaining.filter((o) => o.toLowerCase().includes(q));
  }, [input, remaining]);

  const showCreate =
    input.trim().length > 0 &&
    !options.some((o) => o.toLowerCase() === input.trim().toLowerCase()) &&
    !value.some((v) => v.toLowerCase() === input.trim().toLowerCase());

  function addTag(tag: string) {
    const trimmed = tag.trim();
    if (!trimmed) return;
    if (value.some((x) => x.toLowerCase() === trimmed.toLowerCase())) return;
    onChange([...value, trimmed]);
    setInput("");
    setOpen(false);
  }

  return (
    <div>
      {value.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem", marginBottom: "0.3rem" }}>
          {value.map((t) => (
            <span
              key={t}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.25rem",
                padding: "0.1rem 0.45rem",
                border: "1px solid #999",
                borderRadius: 999,
                fontSize: "0.82rem",
                background: "rgba(127,127,127,0.08)",
              }}
            >
              {t}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => onChange(value.filter((x) => x !== t))}
                  aria-label={`Remove tag ${t}`}
                  style={{
                    background: "transparent",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                    color: "#a00",
                    font: "inherit",
                    fontSize: "0.95rem",
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {!disabled && (
        <div ref={wrapRef} style={{ position: "relative" }}>
          <div
            style={{
              display: "flex",
              border: "1px solid #ccc",
              borderRadius: 3,
              background: "#fff",
            }}
          >
            <input
              type="text"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (input.trim()) addTag(input.trim());
                }
              }}
              placeholder={value.length === 0 ? "Add tag…" : "+ tag"}
              style={{
                flex: 1,
                padding: "0.3rem 0.4rem",
                border: "none",
                outline: "none",
                font: "inherit",
                fontSize: "0.92rem",
                background: "transparent",
                minWidth: 0,
              }}
            />
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                if (open) {
                  setOpen(false);
                } else {
                  setInput("");
                  setOpen(true);
                }
              }}
              aria-label="Toggle tag list"
              style={{
                background: "transparent",
                border: "none",
                padding: "0 0.45rem",
                cursor: "pointer",
                color: "inherit",
                font: "inherit",
              }}
            >
              ▾
            </button>
          </div>
          {open && (
            <div
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                right: 0,
                zIndex: 50,
                marginTop: 2,
                background: "#fff",
                border: "1px solid #ccc",
                borderRadius: 4,
                maxHeight: 240,
                overflowY: "auto",
                boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
              }}
            >
              {showCreate && (
                <div
                  onMouseDown={(e) => {
                    e.preventDefault();
                    addTag(input.trim());
                  }}
                  style={{
                    padding: "0.4rem 0.6rem",
                    cursor: "pointer",
                    fontSize: "0.9rem",
                    borderBottom: "1px solid #eee",
                    color: "#06f",
                  }}
                >
                  + Use &ldquo;{input.trim()}&rdquo;
                </div>
              )}
              {filtered.length === 0 && !showCreate && (
                <div style={{ padding: "0.4rem 0.6rem", opacity: 0.5, fontSize: "0.9rem" }}>
                  {remaining.length === 0 ? "(all tags added)" : "(no matches)"}
                </div>
              )}
              {filtered.map((opt) => (
                <div
                  key={opt}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    addTag(opt);
                  }}
                  style={{
                    padding: "0.4rem 0.6rem",
                    cursor: "pointer",
                    fontSize: "0.9rem",
                  }}
                >
                  {opt}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Modal for editing tags, note, excluded, and oneTime on an import row.
 * Opened via the "Edit" button in the transactions table.
 */
function ImportRowEditModal({
  row,
  edit,
  onChange,
  existingTags,
  existingCategories,
  profiles,
  onClose,
}: {
  row: ClassifiedImportRow;
  edit: ImportRowDecision;
  onChange: (patch: ImportRowDecision) => void;
  existingTags: string[];
  existingCategories: string[];
  profiles: Profile[];
  onClose: () => void;
}) {
  const t = row.parsed;
  const tags = edit.tags ?? t.tags;
  const profileList = profiles ?? [];
  const profileId = edit.profileId ?? row.defaultProfileId ?? profileList[0]?.id ?? DEFAULT_PROFILE_ID;

  function toggleTag(tagId: string) {
    const next = tags.includes(tagId) ? tags.filter((x) => x !== tagId) : [...tags, tagId];
    onChange({ tags: next });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") onClose();
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={handleKeyDown}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 8,
          padding: "1.5rem",
          width: 480,
          maxWidth: "90vw",
          maxHeight: "85vh",
          overflowY: "auto",
          boxShadow: "0 4px 24px rgba(0,0,0,0.18)",
        }}
      >
        <h2 style={{ margin: "0 0 1rem", fontSize: "1.125rem", fontWeight: 600 }}>
          Edit transaction
        </h2>
        <p style={{ margin: "0 0 1rem", fontSize: "0.925rem", opacity: 0.6 }}>
          {t.name}
          {row.accountLabel && (
            <span style={{ marginLeft: "0.5rem", opacity: 0.7 }}>· {row.accountLabel}</span>
          )}
        </p>

        <div style={{ display: "flex", gap: "1rem", marginBottom: "0.9rem" }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: "block", fontSize: "0.905rem", fontWeight: 600, marginBottom: "0.3rem", opacity: 0.7 }}>Date</label>
            <input type="date" value={t.date} readOnly style={{ ...inputStyle, background: "#f9f9f9", color: "#666", width: "100%" }} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ display: "block", fontSize: "0.905rem", fontWeight: 600, marginBottom: "0.3rem", opacity: 0.7 }}>Amount</label>
            <input type="number" value={t.amount} readOnly style={{ ...inputStyle, background: "#f9f9f9", color: "#666", width: "100%" }} />
          </div>
        </div>

        <div style={{ marginBottom: "0.9rem" }}>
          <label style={{ display: "block", fontSize: "0.905rem", fontWeight: 600, marginBottom: "0.3rem", opacity: 0.7 }}>Custom name</label>
          <input
            type="text"
            value={edit.customName ?? ""}
            onChange={(e) => onChange({ customName: e.target.value })}
            placeholder={t.name}
            style={{ ...inputStyle, width: "100%" }}
          />
        </div>

        {profileList.length > 0 && (
          <div style={{ marginBottom: "0.9rem" }}>
            <label style={{ display: "block", fontSize: "0.905rem", fontWeight: 600, marginBottom: "0.3rem", opacity: 0.7 }}>Profile</label>
            <select value={profileId} onChange={(e) => onChange({ profileId: e.target.value })} style={{ ...inputStyle, width: "100%" }}>
              {profileList.map((p) => (
                <option key={p.id} value={p.id}>{p.displayName}</option>
              ))}
            </select>
          </div>
        )}

        <div style={{ marginBottom: "0.9rem" }}>
          <label style={{ display: "block", fontSize: "0.905rem", fontWeight: 600, marginBottom: "0.3rem", opacity: 0.7 }}>Category</label>
          <select
            value={edit.category ?? t.category}
            onChange={(e) => onChange({ category: e.target.value })}
            style={{ ...inputStyle, width: "100%" }}
          >
            <option value="">Uncategorized</option>
            {existingCategories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div style={{ marginBottom: "0.9rem" }}>
          <label style={{ display: "block", fontSize: "0.905rem", fontWeight: 600, marginBottom: "0.3rem", opacity: 0.7 }}>Note</label>
          <textarea
            value={edit.note ?? ""}
            onChange={(e) => onChange({ note: e.target.value })}
            rows={2}
            style={{ ...inputStyle, resize: "vertical", width: "100%" }}
          />
        </div>

        <div style={{ marginBottom: "0.9rem" }}>
          <label style={{ display: "block", fontSize: "0.905rem", fontWeight: 600, marginBottom: "0.3rem", opacity: 0.7 }}>Tags</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.25rem" }}>
            {existingTags.map((tag) => {
              const active = tags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  style={{
                    padding: "0.2rem 0.6rem",
                    borderRadius: 999,
                    fontSize: "0.905rem",
                    border: "1px solid",
                    cursor: "pointer",
                    background: active ? "#333" : "transparent",
                    color: active ? "#fff" : "inherit",
                    borderColor: active ? "#333" : "#ccc",
                  }}
                >
                  {tag}
                </button>
              );
            })}
            {existingTags.length === 0 && (
              <span style={{ fontSize: "0.925rem", opacity: 0.5 }}>No tags defined yet</span>
            )}
          </div>
        </div>

        <div style={{ marginBottom: "0.9rem" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            <label style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={!!edit.excluded}
                onChange={(e) => onChange({ excluded: e.target.checked })}
                style={{ marginTop: "0.15rem" }}
              />
              <span>
                <span style={{ fontSize: "0.975rem", fontWeight: 500 }}>Exclude from everything</span>
                <span style={{ display: "block", fontSize: "0.845rem", opacity: 0.55, marginTop: "0.1rem" }}>
                  Not real spending (e.g. credit card payment, transfer between accounts).
                </span>
              </span>
            </label>
            <label style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={!!edit.oneTime}
                onChange={(e) => onChange({ oneTime: e.target.checked })}
                style={{ marginTop: "0.15rem" }}
              />
              <span>
                <span style={{ fontSize: "0.975rem", fontWeight: 500 }}>One-time / anomaly</span>
                <span style={{ display: "block", fontSize: "0.845rem", opacity: 0.55, marginTop: "0.1rem" }}>
                  Real spending, but excluded from monthly trends and pacing.
                </span>
              </span>
            </label>
          </div>
        </div>

        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "1.25rem" }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "0.4rem 0.9rem",
              border: "1px solid #ccc",
              borderRadius: 4,
              background: "transparent",
              cursor: "pointer",
              marginLeft: "auto",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "0.4rem 0.9rem",
              border: "none",
              borderRadius: 4,
              background: "#333",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.3rem 0.4rem",
  border: "1px solid #ccc",
  borderRadius: 3,
  font: "inherit",
  fontSize: "0.92rem",
  background: "#fff",
  minWidth: 0,
};



function daysBetween(a: string, b: string): number {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 0;
  return Math.max(0, Math.round((tb - ta) / 86400000));
}
