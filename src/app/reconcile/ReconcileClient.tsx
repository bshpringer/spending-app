"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatMoney } from "../../lib/format.ts";
import {
  reconcilePull,
  confirmReconciliation,
  rejectReconciliation,
  confirmReconciliationBatch,
  rejectReconciliationBatch,
  unmarkReconciliation,
  type ReconcilePairDTO,
  type ReconcilePullResult,
} from "../../lib/actions.ts";
import type { Transaction } from "../../lib/types.ts";
import type { ReconciliationStatus } from "../../lib/repo/reconciliationReviewRepo.ts";

export interface ReconcileBankOption {
  itemId: string;
  institutionName: string;
  accountLabels: string[];
  reconciled: boolean;
  defaultFrom: string;
  defaultTo: string;
}

export interface ReconcileReviewedRow {
  csv: Transaction;
  csvAccountLabel: string;
  plaidTransactionId: string;
  status: ReconciliationStatus;
  createdAt: string;
}

type Tab = "unreviewed" | "unmatched" | "reviewed";

interface Props {
  banks: ReconcileBankOption[];
  reviewed: ReconcileReviewedRow[];
  profileParam: string | undefined;
  initialTab: Tab;
  availableTags: { id: string; displayName: string }[];
  availableCategories: string[];
  accountLabels: Record<string, string>;
}

function isBlankCategory(c: string | null | undefined): boolean {
  const v = (c ?? "").trim();
  return v === "" || v.toLowerCase() === "uncategorized";
}
function isBlankCanonical(c: string | null | undefined): boolean {
  return (c ?? "").trim() === "";
}
function pairKey(p: ReconcilePairDTO): string {
  return `${p.csv.id}|${p.plaid.id}`;
}

// ── Field-level diff: one source of truth for the highlight AND the filter ───
type DiffField = "merchant" | "canonical" | "category" | "date" | "description";
const DIFF_FIELDS: { key: DiffField; label: string }[] = [
  { key: "merchant", label: "Merchant" },
  { key: "canonical", label: "Canonical" },
  { key: "category", label: "Category" },
  { key: "date", label: "Date" },
  { key: "description", label: "Description" },
];

/** NFC + collapse whitespace + uppercase — matches the matcher's normDesc. */
function norm(s: string | null | undefined): string {
  return (s ?? "").normalize("NFC").replace(/\s+/g, " ").trim().toUpperCase();
}
function dispMerchant(t: Transaction): string {
  return t.customName ?? t.canonicalName ?? t.name;
}
function aggDate(t: Transaction): string {
  return t.originalDate || t.date;
}

/** True for each field where Rocket and Plaid disagree (trim/case-insensitive). */
function computeDiffs(p: ReconcilePairDTO): Record<DiffField, boolean> {
  const { csv, plaid } = p;
  return {
    merchant: norm(dispMerchant(csv)) !== norm(dispMerchant(plaid)),
    canonical: norm(csv.canonicalName) !== norm(plaid.canonicalName),
    category: norm(csv.category) !== norm(plaid.category),
    date: aggDate(csv) !== aggDate(plaid),
    description: norm(csv.description) !== norm(plaid.description),
  };
}

export default function ReconcileClient(props: Props) {
  const router = useRouter();
  const reconciledBanks = props.banks.filter((b) => b.reconciled);

  const [itemId, setItemId] = useState<string>(reconciledBanks[0]?.itemId ?? "");
  const selectedBank = props.banks.find((b) => b.itemId === itemId);
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState<string>(selectedBank?.defaultFrom ?? "");
  const [to, setTo] = useState<string>(selectedBank?.defaultTo ?? today);

  const [pulling, setPulling] = useState(false);
  const [pullError, setPullError] = useState<string | null>(null);
  const [result, setResult] = useState<ReconcilePullResult | null>(null);
  const [tab, setTab] = useState<Tab>(props.initialTab);
  const [isActing, startActing] = useTransition();
  // Per-pair overwrite opt-ins for hand-tuned fields that differ.
  const [overwrite, setOverwrite] = useState<Record<string, { cat?: boolean; canon?: boolean }>>({});
  // "Show only pairs that differ on …" — AND semantics across checked fields.
  const [diffFilter, setDiffFilter] = useState<Set<DiffField>>(new Set());
  // Mutually exclusive with diffFilter: show only pairs with NO differences.
  const [onlyNoDiff, setOnlyNoDiff] = useState(false);
  // Multi-select for bulk approve/reject (keyed by pairKey).
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const profileSuffix = props.profileParam ? `?profile=${encodeURIComponent(props.profileParam)}` : "";

  function onBankChange(next: string) {
    setItemId(next);
    const b = props.banks.find((x) => x.itemId === next);
    setFrom(b?.defaultFrom ?? "");
    setTo(b?.defaultTo ?? today);
    setResult(null);
    setPullError(null);
  }

  async function handlePull() {
    if (!itemId) return;
    setPulling(true);
    setPullError(null);
    try {
      const res = await reconcilePull({ itemId, from, to });
      if (!res.ok) {
        setPullError(res.error ?? "Pull failed.");
        setResult(null);
      } else {
        setResult(res);
        setOverwrite({});
        setSelected(new Set());
        setDiffFilter(new Set());
        setOnlyNoDiff(false);
        setTab("unreviewed");
      }
    } catch (err) {
      setPullError(err instanceof Error ? err.message : "Pull failed.");
    } finally {
      setPulling(false);
    }
  }

  function dropKeys(keys: Set<string>) {
    setResult((prev) =>
      prev ? { ...prev, matched: prev.matched.filter((p) => !keys.has(pairKey(p))) } : prev,
    );
    setSelected((prev) => {
      const next = new Set(prev);
      for (const k of keys) next.delete(k);
      return next;
    });
  }
  function dropPair(key: string) {
    dropKeys(new Set([key]));
  }

  function optsFor(p: ReconcilePairDTO) {
    const o = overwrite[pairKey(p)];
    return { overwriteCategory: o?.cat ?? false, overwriteCanonicalName: o?.canon ?? false };
  }

  function handleBulkConfirm(pairs: ReconcilePairDTO[]) {
    if (pairs.length === 0) return;
    startActing(async () => {
      const res = await confirmReconciliationBatch(
        pairs.map((p) => ({ csvTransactionId: p.csv.id, enrich: p.enrich, opts: optsFor(p) })),
      );
      const okKeys = new Set(res.succeeded.map((s) => `${s.csvTransactionId}|${s.plaidTransactionId}`));
      dropKeys(okKeys);
      if (res.failures.length > 0) {
        window.alert(`${res.failures.length} pair(s) could not be enriched. First error: ${res.failures[0].error}`);
      }
      router.refresh();
    });
  }

  function handleBulkReject(pairs: ReconcilePairDTO[]) {
    if (pairs.length === 0) return;
    startActing(async () => {
      await rejectReconciliationBatch(
        pairs.map((p) => ({ csvTransactionId: p.csv.id, plaidTransactionId: p.plaid.id })),
      );
      dropKeys(new Set(pairs.map(pairKey)));
      router.refresh();
    });
  }

  function handleConfirm(pair: ReconcilePairDTO) {
    const key = pairKey(pair);
    const opts = {
      overwriteCategory: overwrite[key]?.cat ?? false,
      overwriteCanonicalName: overwrite[key]?.canon ?? false,
    };
    startActing(async () => {
      const res = await confirmReconciliation(pair.csv.id, pair.enrich, opts);
      if (!res.ok) {
        window.alert(`Could not enrich: ${res.error ?? "unknown error"}`);
        return;
      }
      dropPair(key);
      router.refresh();
    });
  }

  function handleReject(pair: ReconcilePairDTO) {
    const key = pairKey(pair);
    startActing(async () => {
      await rejectReconciliation(pair.csv.id, pair.plaid.id);
      dropPair(key);
      router.refresh();
    });
  }

  function handleUndo(row: ReconcileReviewedRow) {
    startActing(async () => {
      await unmarkReconciliation(row.csv.id, row.plaidTransactionId);
      router.refresh();
    });
  }

  const matched = result?.matched ?? [];
  const unmatchedPlaid = result?.unmatchedPlaid ?? [];
  const unmatchedCsv = result?.unmatchedCsv ?? [];

  return (
    <main style={{ padding: "1.5rem 2rem", maxWidth: 1100, margin: "0 auto", width: "100%" }}>
      <h1 style={{ fontSize: "1.75rem", fontWeight: 700, margin: "0 0 0.25rem" }}>Reconcile</h1>
      <div style={{ fontSize: "0.95rem", opacity: 0.75, marginBottom: "1.25rem", lineHeight: 1.5 }}>
        Pair each old Rocket transaction with its Plaid twin so Plaid&apos;s richer fields can{" "}
        <strong>enrich the surviving Rocket row in place</strong> — without ever committing the Plaid
        copy (so the overlap window can&apos;t double-count). The Plaid side is pulled fresh per bank;
        nothing is written until you confirm a pair.{" "}
        <Link href={`/transactions${profileSuffix}`} style={{ color: "#2563eb", textDecoration: "none" }}>
          ← Back to transactions
        </Link>
      </div>

      {/* ── Pull controls ── */}
      <div style={controlsCard}>
        {reconciledBanks.length === 0 ? (
          <span style={{ opacity: 0.7 }}>
            No reconciled Plaid banks yet — link &amp; reconcile a bank on{" "}
            <Link href="/settings/plaid" style={{ color: "#2563eb" }}>
              Plaid Import
            </Link>{" "}
            first.
          </span>
        ) : (
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "flex-end" }}>
            <label style={fieldLabel}>
              Bank
              <select value={itemId} onChange={(e) => onBankChange(e.target.value)} style={selectStyle}>
                {reconciledBanks.map((b) => (
                  <option key={b.itemId} value={b.itemId}>
                    {b.institutionName}
                  </option>
                ))}
              </select>
            </label>
            <label style={fieldLabel}>
              From
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={inputStyle} />
            </label>
            <label style={fieldLabel}>
              To
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={inputStyle} />
            </label>
            <button onClick={handlePull} disabled={pulling || !itemId} style={pullBtn}>
              {pulling ? "Pulling from Plaid…" : "Pull & match"}
            </button>
          </div>
        )}
        {selectedBank && selectedBank.accountLabels.length > 0 && (
          <div style={{ fontSize: "0.78rem", opacity: 0.6, marginTop: 8 }}>
            Accounts: {selectedBank.accountLabels.join(" · ")}
          </div>
        )}
        {pullError && (
          <div style={{ marginTop: 10, color: "#b91c1c", fontSize: "0.85rem" }}>{pullError}</div>
        )}
        {result && (
          <div style={{ fontSize: "0.82rem", opacity: 0.7, marginTop: 10 }}>
            Pulled {result.pulledCount} Plaid rows · {matched.length} proposed pairs ·{" "}
            {unmatchedPlaid.length} Plaid + {unmatchedCsv.length} Rocket unmatched in window.
          </div>
        )}
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: "inline-flex", gap: 4, margin: "1.25rem 0 1rem" }}>
        <button onClick={() => setTab("unreviewed")} style={pillStyle(tab === "unreviewed")}>
          Unreviewed ({matched.length})
        </button>
        <button onClick={() => setTab("unmatched")} style={pillStyle(tab === "unmatched")}>
          Unmatched ({unmatchedPlaid.length + unmatchedCsv.length})
        </button>
        <button onClick={() => setTab("reviewed")} style={pillStyle(tab === "reviewed")}>
          Reviewed ({props.reviewed.length})
        </button>
      </div>

      {tab === "unreviewed" && (
        <UnreviewedSection
          pairs={matched}
          pulled={!!result}
          isActing={isActing}
          overwrite={overwrite}
          setOverwrite={setOverwrite}
          diffFilter={diffFilter}
          setDiffFilter={setDiffFilter}
          onlyNoDiff={onlyNoDiff}
          setOnlyNoDiff={setOnlyNoDiff}
          selected={selected}
          setSelected={setSelected}
          onConfirm={handleConfirm}
          onReject={handleReject}
          onBulkConfirm={handleBulkConfirm}
          onBulkReject={handleBulkReject}
        />
      )}
      {tab === "unmatched" && (
        <UnmatchedSection plaid={unmatchedPlaid} csv={unmatchedCsv} pulled={!!result} />
      )}
      {tab === "reviewed" && (
        <ReviewedSection rows={props.reviewed} isActing={isActing} onUndo={handleUndo} />
      )}
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

type PageSize = 50 | 100 | "all";

function UnreviewedSection(props: {
  pairs: ReconcilePairDTO[];
  pulled: boolean;
  isActing: boolean;
  overwrite: Record<string, { cat?: boolean; canon?: boolean }>;
  setOverwrite: React.Dispatch<React.SetStateAction<Record<string, { cat?: boolean; canon?: boolean }>>>;
  diffFilter: Set<DiffField>;
  setDiffFilter: React.Dispatch<React.SetStateAction<Set<DiffField>>>;
  onlyNoDiff: boolean;
  setOnlyNoDiff: React.Dispatch<React.SetStateAction<boolean>>;
  selected: Set<string>;
  setSelected: React.Dispatch<React.SetStateAction<Set<string>>>;
  onConfirm: (p: ReconcilePairDTO) => void;
  onReject: (p: ReconcilePairDTO) => void;
  onBulkConfirm: (pairs: ReconcilePairDTO[]) => void;
  onBulkReject: (pairs: ReconcilePairDTO[]) => void;
}) {
  const [pageSize, setPageSize] = useState<PageSize>(50);
  const [page, setPage] = useState(0);

  // Per-field difference counts (over the full pulled set) + the filtered view.
  const { filtered, counts, noDiffCount } = useMemo(() => {
    const counts: Record<DiffField, number> = {
      merchant: 0,
      canonical: 0,
      category: 0,
      date: 0,
      description: 0,
    };
    let noDiffCount = 0;
    const checked = [...props.diffFilter];
    const filtered: ReconcilePairDTO[] = [];
    for (const p of props.pairs) {
      const d = computeDiffs(p);
      let any = false;
      for (const f of DIFF_FIELDS) {
        if (d[f.key]) {
          counts[f.key]++;
          any = true;
        }
      }
      if (!any) noDiffCount++;
      const passNoDiff = props.onlyNoDiff ? !any : true;
      const passFields = checked.every((f) => d[f]);
      if (passNoDiff && passFields) filtered.push(p);
    }
    return { filtered, counts, noDiffCount };
  }, [props.pairs, props.diffFilter, props.onlyNoDiff]);

  // Reset to first page whenever the filtered set or page size changes.
  const filterSig = `${[...props.diffFilter].sort().join(",")}|${props.onlyNoDiff}|${pageSize}|${filtered.length}`;
  useEffect(() => setPage(0), [filterSig]);

  function toggleField(f: DiffField) {
    props.setOnlyNoDiff(false);
    props.setDiffFilter((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  }
  function toggleNoDiff(on: boolean) {
    props.setOnlyNoDiff(on);
    if (on) props.setDiffFilter(new Set());
  }

  if (!props.pulled) {
    return <p style={{ opacity: 0.6 }}>Pick a bank and date window above, then <strong>Pull &amp; match</strong>.</p>;
  }
  if (props.pairs.length === 0) {
    return <p style={{ opacity: 0.6 }}>No proposed pairs in this window — everything is already reviewed or has no twin.</p>;
  }

  const filterActive = props.diffFilter.size > 0 || props.onlyNoDiff;
  const total = filtered.length;
  const size = pageSize === "all" ? total || 1 : pageSize;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const clampedPage = Math.min(page, pageCount - 1);
  const start = clampedPage * size;
  const pageItems = filtered.slice(start, start + size);

  // Selection works over the WHOLE filtered set (across pages), as requested.
  const filteredKeys = filtered.map(pairKey);
  const selectedInFiltered = filteredKeys.filter((k) => props.selected.has(k));
  const allFilteredSelected = total > 0 && selectedInFiltered.length === total;
  const selectedPairs = filtered.filter((p) => props.selected.has(pairKey(p)));

  function selectAllFiltered() {
    props.setSelected((prev) => {
      const next = new Set(prev);
      for (const k of filteredKeys) next.add(k);
      return next;
    });
  }
  function clearSelection() {
    props.setSelected((prev) => {
      const next = new Set(prev);
      for (const k of filteredKeys) next.delete(k);
      return next;
    });
  }
  function toggleSelect(key: string, on: boolean) {
    props.setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <div style={filterBar}>
        <span style={{ fontSize: "0.78rem", fontWeight: 600, opacity: 0.7 }}>Show only pairs that differ on:</span>
        {DIFF_FIELDS.map((f) => (
          <label key={f.key} style={{ ...checkboxLabel, opacity: counts[f.key] === 0 ? 0.4 : 1 }}>
            <input type="checkbox" checked={props.diffFilter.has(f.key)} onChange={() => toggleField(f.key)} />
            {f.label} <span style={{ opacity: 0.5 }}>({counts[f.key]})</span>
          </label>
        ))}
        <span style={{ opacity: 0.4 }}>·</span>
        <label style={{ ...checkboxLabel, fontWeight: 600 }} title="Pairs where every field agrees — the safe bulk-accept set">
          <input type="checkbox" checked={props.onlyNoDiff} onChange={(e) => toggleNoDiff(e.target.checked)} />
          No differences <span style={{ opacity: 0.5 }}>({noDiffCount})</span>
        </label>
        {filterActive && (
          <button
            onClick={() => {
              props.setDiffFilter(new Set());
              props.setOnlyNoDiff(false);
            }}
            style={{ ...smallBtn, marginLeft: "auto" }}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Bulk action + pagination bar */}
      <div style={bulkBar}>
        <label style={checkboxLabel}>
          <input
            type="checkbox"
            checked={allFilteredSelected}
            ref={(el) => {
              if (el) el.indeterminate = selectedInFiltered.length > 0 && !allFilteredSelected;
            }}
            onChange={(e) => (e.target.checked ? selectAllFiltered() : clearSelection())}
          />
          Select all{filterActive ? " filtered" : ""} ({total})
        </label>
        {selectedInFiltered.length > 0 && (
          <>
            <span style={{ fontSize: "0.82rem", fontWeight: 600 }}>{selectedInFiltered.length} selected</span>
            <button
              disabled={props.isActing}
              onClick={() => props.onBulkConfirm(selectedPairs)}
              style={primaryBtn}
              title="Confirm & enrich every selected pair"
            >
              Confirm {selectedInFiltered.length} &amp; enrich
            </button>
            <button
              disabled={props.isActing}
              onClick={() => props.onBulkReject(selectedPairs)}
              style={dangerBtn}
              title="Mark every selected pair as not-a-match"
            >
              Reject {selectedInFiltered.length}
            </button>
          </>
        )}
        <label style={{ ...checkboxLabel, marginLeft: "auto" }}>
          Per page:
          <select
            value={String(pageSize)}
            onChange={(e) => setPageSize(e.target.value === "all" ? "all" : (Number(e.target.value) as PageSize))}
            style={{ ...selectStyle, minWidth: 70, padding: "0.25rem 0.4rem" }}
          >
            <option value="50">50</option>
            <option value="100">100</option>
            <option value="all">All</option>
          </select>
        </label>
      </div>

      <div style={{ fontSize: "0.8rem", opacity: 0.6, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span>
          {filterActive ? `${total} of ${props.pairs.length} pairs` : `${total} pairs`}
          {pageSize !== "all" && total > size && (
            <> · showing {start + 1}–{Math.min(start + size, total)}</>
          )}
        </span>
        {pageCount > 1 && (
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <button disabled={clampedPage === 0} onClick={() => setPage(clampedPage - 1)} style={smallBtn}>
              ‹ Prev
            </button>
            <span>page {clampedPage + 1}/{pageCount}</span>
            <button disabled={clampedPage >= pageCount - 1} onClick={() => setPage(clampedPage + 1)} style={smallBtn}>
              Next ›
            </button>
          </span>
        )}
      </div>

      {total === 0 ? (
        <p style={{ opacity: 0.6 }}>
          {props.onlyNoDiff
            ? "No fully-agreeing pairs in this set."
            : "No pairs differ on all of the selected fields."}
        </p>
      ) : (
        pageItems.map((p) => (
          <PairCard
            key={pairKey(p)}
            pair={p}
            isActing={props.isActing}
            selected={props.selected.has(pairKey(p))}
            onToggleSelect={(on) => toggleSelect(pairKey(p), on)}
            overwrite={props.overwrite[pairKey(p)] ?? {}}
            setOverwrite={(patch) =>
              props.setOverwrite((prev) => ({ ...prev, [pairKey(p)]: { ...prev[pairKey(p)], ...patch } }))
            }
            onConfirm={() => props.onConfirm(p)}
            onReject={() => props.onReject(p)}
          />
        ))
      )}
    </div>
  );
}

function PairCard(props: {
  pair: ReconcilePairDTO;
  isActing: boolean;
  selected: boolean;
  onToggleSelect: (on: boolean) => void;
  overwrite: { cat?: boolean; canon?: boolean };
  setOverwrite: (patch: { cat?: boolean; canon?: boolean }) => void;
  onConfirm: () => void;
  onReject: () => void;
}) {
  const { csv, plaid } = props.pair;
  const csvMerchant = csv.customName ?? csv.canonicalName ?? csv.name;
  const plaidMerchant = plaid.customName ?? plaid.canonicalName ?? plaid.name;

  const canonFillable = isBlankCanonical(csv.canonicalName) && !!(plaid.canonicalName ?? "").trim();
  const canonConflict =
    !isBlankCanonical(csv.canonicalName) &&
    !!(plaid.canonicalName ?? "").trim() &&
    (csv.canonicalName ?? "").trim() !== (plaid.canonicalName ?? "").trim();

  const catFillable = isBlankCategory(csv.category) && !!(plaid.category ?? "").trim();
  const catConflict =
    !isBlankCategory(csv.category) &&
    !!(plaid.category ?? "").trim() &&
    csv.category.trim() !== plaid.category.trim();

  const diffs = computeDiffs(props.pair);

  // Summarize what Confirm will actually write.
  const willWrite: string[] = [];
  if (isBlankCanonical(csv.canonicalName) && (plaid.canonicalName ?? "").trim()) willWrite.push("canonicalName");
  else if (canonConflict && props.overwrite.canon) willWrite.push("canonicalName (overwrite)");
  if (isBlankCategory(csv.category) && (plaid.category ?? "").trim()) willWrite.push("category");
  else if (catConflict && props.overwrite.cat) willWrite.push("category (overwrite)");
  willWrite.push("plaidTransactionId", "plaidRaw");

  return (
    <div style={{ ...cardStyle, ...(props.selected ? { borderColor: "#2563eb", boxShadow: "0 0 0 1px #2563eb" } : {}) }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <label style={{ ...checkboxLabel, fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.05em", opacity: 0.6 }}>
          <input type="checkbox" checked={props.selected} onChange={(e) => props.onToggleSelect(e.target.checked)} />
          Proposed pair
        </label>
        <TierBadge tier={props.pair.tier} daysApart={props.pair.daysApart} />
      </div>

      {/* Field-level diff grid: field | Rocket | Plaid */}
      <div style={diffGrid}>
        <DiffHeader />
        <DiffRow label="merchant" rocket={csvMerchant} plaid={plaidMerchant} differs={diffs.merchant} />
        <DiffRow
          label="canonical"
          rocket={csv.canonicalName || "—"}
          plaid={plaid.canonicalName || "—"}
          enrich={canonFillable}
          differs={canonConflict}
        />
        <DiffRow
          label="category"
          rocket={csv.category || "—"}
          plaid={plaid.category || "—"}
          enrich={catFillable}
          differs={catConflict}
        />
        <DiffRow
          label="date"
          rocket={csv.originalDate || csv.date}
          plaid={plaid.originalDate || plaid.date}
          differs={diffs.date}
          subtle
        />
        <DiffRow
          label="amount"
          rocket={formatMoney(csv.amount)}
          plaid={formatMoney(plaid.amount)}
          subtle
        />
        <DiffRow
          label="description"
          rocket={(csv.description || "—").slice(0, 80)}
          plaid={(plaid.description || "—").slice(0, 80)}
          differs={diffs.description}
          subtle
        />
      </div>

      <div style={{ fontSize: "0.78rem", opacity: 0.6, margin: "8px 0" }}>{props.pair.reason}</div>

      {/* Overwrite opt-ins only when Rocket has a hand-tuned value that differs */}
      {(canonConflict || catConflict) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, margin: "4px 0 10px" }}>
          {canonConflict && (
            <label style={checkboxLabel}>
              <input
                type="checkbox"
                checked={props.overwrite.canon ?? false}
                onChange={(e) => props.setOverwrite({ canon: e.target.checked })}
              />
              Overwrite canonical &ldquo;{csv.canonicalName}&rdquo; → &ldquo;{plaid.canonicalName}&rdquo;
            </label>
          )}
          {catConflict && (
            <label style={checkboxLabel}>
              <input
                type="checkbox"
                checked={props.overwrite.cat ?? false}
                onChange={(e) => props.setOverwrite({ cat: e.target.checked })}
              />
              Overwrite category &ldquo;{csv.category}&rdquo; → &ldquo;{plaid.category}&rdquo;
            </label>
          )}
        </div>
      )}

      <div style={{ fontSize: "0.74rem", opacity: 0.55, marginBottom: 8 }}>
        Confirm will write: {willWrite.join(", ")}
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button
          disabled={props.isActing}
          onClick={props.onConfirm}
          style={primaryBtn}
          title="Same purchase — enrich the Rocket row with Plaid's fields and stamp provenance"
        >
          Confirm &amp; enrich
        </button>
        <button
          disabled={props.isActing}
          onClick={props.onReject}
          style={dangerBtn}
          title="Not the same purchase — never suggest this pair again"
        >
          Not a match
        </button>
      </div>
    </div>
  );
}

function DiffHeader() {
  return (
    <>
      <span style={diffLabelCell} />
      <span style={{ ...diffHeadCell }}>Rocket (old)</span>
      <span style={{ ...diffHeadCell }}>Plaid (rich)</span>
    </>
  );
}

function DiffRow(props: {
  label: string;
  rocket: string;
  plaid: string;
  enrich?: boolean;
  differs?: boolean;
  subtle?: boolean;
}) {
  // enrich (green, will-write) wins over differs (orange, informational).
  const bg = props.enrich ? "#ecfdf5" : props.differs ? "#fff7ed" : "transparent";
  return (
    <>
      <span style={diffLabelCell}>{props.label}</span>
      <span
        data-sensitive
        style={{ ...diffValCell, opacity: props.subtle && !props.differs ? 0.7 : 1, background: props.differs && !props.enrich ? "#fffbeb" : "transparent", borderRadius: 3 }}
      >
        {props.rocket}
      </span>
      <span data-sensitive style={{ ...diffValCell, background: bg, borderRadius: 3 }}>
        {props.plaid}
        {props.enrich && <span style={hintTag}>→ fills blank</span>}
        {props.differs && !props.enrich && <span style={{ ...hintTag, color: "#9a3412" }}>differs</span>}
      </span>
    </>
  );
}

function UnmatchedSection(props: { plaid: Transaction[]; csv: Transaction[]; pulled: boolean }) {
  if (!props.pulled) {
    return <p style={{ opacity: 0.6 }}>Pull a window first to see coverage gaps.</p>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <div>
        <h3 style={subhead}>Plaid rows with no Rocket twin ({props.plaid.length})</h3>
        <p style={{ fontSize: "0.8rem", opacity: 0.6, margin: "0 0 8px" }}>
          Genuinely-missing transactions (or below the match threshold). To import them as new rows,
          use <strong>Backfill range</strong> on{" "}
          <Link href="/settings/plaid" style={{ color: "#2563eb" }}>Plaid Import</Link>.
        </p>
        <MiniList txns={props.plaid} />
      </div>
      <div>
        <h3 style={subhead}>Rocket rows with no Plaid twin ({props.csv.length})</h3>
        <p style={{ fontSize: "0.8rem", opacity: 0.6, margin: "0 0 8px" }}>
          Likely outside Plaid&apos;s returned history, or a charge Plaid renders differently. Nothing to do —
          this is a coverage audit.
        </p>
        <MiniList txns={props.csv} />
      </div>
    </div>
  );
}

function MiniList(props: { txns: Transaction[] }) {
  if (props.txns.length === 0) return <p style={{ opacity: 0.5, fontSize: "0.85rem" }}>None.</p>;
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {props.txns.slice(0, 200).map((t) => {
        const merchant = t.customName ?? t.canonicalName ?? t.name;
        return (
          <div key={t.id} style={miniRow}>
            <span style={{ fontSize: "0.78rem", opacity: 0.6, width: 90, fontVariantNumeric: "tabular-nums" }}>
              {t.originalDate || t.date}
            </span>
            <span data-sensitive style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {merchant}
              {t.category && <span style={{ opacity: 0.55 }}> · {t.category}</span>}
            </span>
            <span data-sensitive style={{ color: t.amount < 0 ? "#a00" : "#070", fontVariantNumeric: "tabular-nums" }}>
              {formatMoney(t.amount)}
            </span>
          </div>
        );
      })}
      {props.txns.length > 200 && (
        <span style={{ opacity: 0.5, fontSize: "0.78rem", marginTop: 4 }}>
          …and {props.txns.length - 200} more
        </span>
      )}
    </div>
  );
}

function ReviewedSection(props: {
  rows: ReconcileReviewedRow[];
  isActing: boolean;
  onUndo: (r: ReconcileReviewedRow) => void;
}) {
  if (props.rows.length === 0) {
    return <p style={{ opacity: 0.6 }}>No reviewed pairs yet. Confirmed &amp; rejected pairs land here.</p>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
      {props.rows.map((r) => {
        const merchant = r.csv.customName ?? r.csv.canonicalName ?? r.csv.name;
        const reconciled = r.status === "reconciled";
        return (
          <div key={`${r.csv.id}|${r.plaidTransactionId}`} style={{ ...cardStyle, opacity: 0.85 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <span
                  style={{
                    fontSize: "0.72rem",
                    padding: "2px 8px",
                    borderRadius: 999,
                    background: reconciled ? "#dcfce7" : "#fee2e2",
                    color: reconciled ? "#166534" : "#991b1b",
                    fontWeight: 600,
                    marginRight: 8,
                  }}
                >
                  {reconciled ? "Enriched" : "Not a match"}
                </span>
                <span data-sensitive style={{ fontWeight: 500 }}>{merchant}</span>
                <span style={{ opacity: 0.6, fontSize: "0.82rem" }}>
                  {" "}· {r.csv.originalDate || r.csv.date} · {r.csvAccountLabel}
                  {r.csv.category && <> · {r.csv.category}</>}
                </span>
                <div
                  style={{
                    fontSize: "0.74rem",
                    opacity: 0.5,
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    marginTop: 2,
                  }}
                >
                  plaid_id: {r.plaidTransactionId}
                </div>
              </div>
              <span data-sensitive style={{ color: r.csv.amount < 0 ? "#a00" : "#070", fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>
                {formatMoney(r.csv.amount)}
              </span>
            </div>
            <div style={{ marginTop: 8 }}>
              <button
                disabled={props.isActing}
                onClick={() => props.onUndo(r)}
                style={smallBtn}
                title={
                  reconciled
                    ? "Removes the decision so the pair can be suggested again. Does NOT roll back the enrichment already written."
                    : "Removes the rejection so the pair can be suggested again."
                }
              >
                Undo
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TierBadge(props: { tier: ReconcilePairDTO["tier"]; daysApart: number }) {
  const high = props.tier === "desc-exact" || props.tier === "fallback-high";
  const label =
    props.tier === "desc-exact"
      ? "Exact description"
      : props.tier === "fallback-high"
        ? "High confidence"
        : "Medium confidence";
  return (
    <span
      style={{
        fontSize: "0.72rem",
        padding: "2px 8px",
        borderRadius: 999,
        background: high ? "#dbeafe" : "#fef3c7",
        color: high ? "#1e40af" : "#92400e",
        fontWeight: 600,
      }}
      title={`${props.tier} · ${props.daysApart} day(s) apart`}
    >
      {label} · ±{props.daysApart}d
    </span>
  );
}

// ── styles ───────────────────────────────────────────────────────────────────
const controlsCard: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  padding: "1rem 1.25rem",
  background: "#f9fafb",
};
const fieldLabel: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: "0.78rem",
  fontWeight: 600,
  opacity: 0.75,
};
const selectStyle: React.CSSProperties = {
  padding: "0.4rem 0.6rem",
  border: "1px solid #ccc",
  borderRadius: 6,
  fontSize: "0.9rem",
  minWidth: 200,
};
const inputStyle: React.CSSProperties = {
  padding: "0.4rem 0.6rem",
  border: "1px solid #ccc",
  borderRadius: 6,
  fontSize: "0.9rem",
};
const pullBtn: React.CSSProperties = {
  padding: "0.5rem 1.1rem",
  background: "#2563eb",
  color: "#fff",
  border: "1px solid #2563eb",
  borderRadius: 6,
  fontSize: "0.9rem",
  fontWeight: 600,
  cursor: "pointer",
};
const cardStyle: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  padding: "0.85rem 1rem",
  background: "#fff",
};
const diffGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "90px 1fr 1fr",
  gap: "2px 12px",
  alignItems: "baseline",
  fontSize: "0.85rem",
};
const diffLabelCell: React.CSSProperties = {
  fontSize: "0.72rem",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  opacity: 0.5,
  paddingTop: 2,
};
const diffHeadCell: React.CSSProperties = {
  fontSize: "0.72rem",
  fontWeight: 700,
  opacity: 0.55,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};
const diffValCell: React.CSSProperties = {
  padding: "1px 4px",
  minWidth: 0,
  wordBreak: "break-word",
};
const hintTag: React.CSSProperties = {
  marginLeft: 6,
  fontSize: "0.68rem",
  fontWeight: 700,
  color: "#047857",
  textTransform: "uppercase",
  letterSpacing: "0.03em",
};
const checkboxLabel: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: "0.8rem",
  cursor: "pointer",
};
const filterBar: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 14,
  flexWrap: "wrap",
  padding: "0.6rem 0.85rem",
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  background: "#f9fafb",
};
const bulkBar: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
  padding: "0.5rem 0.85rem",
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  background: "#fff",
};
const subhead: React.CSSProperties = {
  fontSize: "0.95rem",
  fontWeight: 700,
  margin: "0 0 4px",
};
const miniRow: React.CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "baseline",
  padding: "4px 0",
  borderBottom: "1px solid #f1f5f9",
  fontSize: "0.85rem",
};
const smallBtn: React.CSSProperties = {
  padding: "0.3rem 0.7rem",
  fontSize: "0.8rem",
  background: "#fff",
  border: "1px solid #ccc",
  borderRadius: 4,
  cursor: "pointer",
};
const primaryBtn: React.CSSProperties = {
  ...smallBtn,
  background: "#2563eb",
  borderColor: "#2563eb",
  color: "#fff",
  fontWeight: 500,
};
const dangerBtn: React.CSSProperties = {
  ...smallBtn,
  borderColor: "#fca5a5",
  color: "#b91c1c",
};
function pillStyle(active: boolean): React.CSSProperties {
  return {
    padding: "0.35rem 0.8rem",
    border: "1px solid",
    borderColor: active ? "#2563eb" : "#ccc",
    background: active ? "#2563eb" : "#fff",
    color: active ? "#fff" : "#333",
    borderRadius: 999,
    fontSize: "0.85rem",
    cursor: "pointer",
  };
}
