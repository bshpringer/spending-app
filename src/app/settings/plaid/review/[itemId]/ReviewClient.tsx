"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { formatMoney } from "@/lib/format.ts";
import type { PlaidStagingAction, PlaidStagingRemovalAction, Profile } from "@/lib/types.ts";
import type { RulePreview } from "./stagingRulePreview.ts";
import type { RawDetail } from "./rawDetail.ts";

export interface MatchedTxnView {
  id: string;
  date: string;
  name: string;
  amount: number;
  category: string;
}

export interface RemovalRowView {
  plaidTransactionId: string;
  matchedTransactionId: string;
  matchedDate: string;
  matchedName: string;
  matchedAmount: number;
  proposedAction: PlaidStagingRemovalAction;
  replacementHint: string | null;
}

export interface StagedRowView {
  stagingId: string;
  plaidTransactionId: string;
  accountId: string | null;
  accountLabel: string | null;
  accountInstitution: string | null;
  profileId: string | null;
  date: string;
  originalDate: string;
  name: string;
  customName: string | null;
  canonicalName: string | null;
  amount: number;
  description: string;
  category: string;
  note: string;
  tags: string[];
  proposedAction: PlaidStagingAction;
  matchedTransactionId: string | null;
  flagReason: string | null;
  replacesTransactionId: string | null;
  /**
   * Where the canonical name came from at sync time (stable — does not change as
   * the user edits the box). Drives the reason line under the Canonical input.
   * `null` = nothing pre-filled (defaults to the raw Plaid name).
   */
  canonicalSource: "alias" | "alias-medium" | null;
  /**
   * "alias" when the staged category still equals the merchant alias's
   * defaultCategory (i.e. the alias is filling Category) — drives the blue
   * highlight on the Category box. `null` once the user overrides it or no
   * alias set it.
   */
  categorySource: "alias" | null;
  /**
   * The category Plaid originally assigned (recovered from plaidRawFull), used
   * as the baseline for deciding whether a rule actually overwrites Category.
   * `null` when it couldn't be recovered.
   */
  plaidCategory: string | null;
  /** Curated Plaid fields for the raw-name hover card. */
  rawDetail: RawDetail | null;
  rulePreview?: RulePreview | null;
}

interface ReviewClientProps {
  itemId: string;
  rows: StagedRowView[];
  removalRows: RemovalRowView[];
  matchedById: Record<string, MatchedTxnView>;
  categories: string[];
  profiles: Profile[];
  canonicalSuggestions: string[];
  customSuggestions: string[];
  customByCanonical: Record<string, string[]>;
  /**
   * Override the post-commit navigation (used by /settings/plaid/review-all to
   * advance tabs without leaving the page). Default behavior: push to
   * /settings/plaid.
   */
  onAfterCommit?: () => void;
  /** Override the post-discard navigation. Default: push to /settings/plaid. */
  onAfterDiscard?: () => void;
}

export function ReviewClient({
  itemId,
  rows: initialRows,
  removalRows: initialRemovals,
  matchedById,
  categories,
  profiles,
  canonicalSuggestions,
  customSuggestions,
  customByCanonical,
  onAfterCommit,
  onAfterDiscard,
}: ReviewClientProps) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [removals, setRemovals] = useState(initialRemovals);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  // Most saves resolve in well under 100ms, so showing "Saving…" immediately
  // just flashes a gnat. Only surface it (top indicator + row highlight) once a
  // save has been in flight past this threshold.
  const [showSaving, setShowSaving] = useState(false);
  useEffect(() => {
    if (!savingId) {
      setShowSaving(false);
      return;
    }
    const t = setTimeout(() => setShowSaving(true), 400);
    return () => clearTimeout(t);
  }, [savingId]);

  const autoResolved = useMemo(() => rows.filter((r) => r.replacesTransactionId), [rows]);
  const flagged = useMemo(
    () => rows.filter((r) => r.flagReason && !r.replacesTransactionId),
    [rows],
  );
  const fresh = useMemo(
    () => rows.filter((r) => !r.flagReason && !r.replacesTransactionId),
    [rows],
  );

  const keepCount = rows.filter((r) => r.proposedAction === "keep").length;
  const mergeCount = rows.filter((r) => r.proposedAction === "merge").length;
  const skipCount = rows.filter((r) => r.proposedAction === "skip").length;
  const deleteCount = removals.filter((r) => r.proposedAction === "delete").length;
  const ignoreRemovalCount = removals.filter((r) => r.proposedAction === "ignore").length;

  const patchRow = (stagingId: string, patch: Partial<StagedRowView>) => {
    setRows((prev) => prev.map((r) => (r.stagingId === stagingId ? { ...r, ...patch } : r)));
  };

  const persist = useCallback(
    async (stagingId: string, patch: Partial<StagedRowView>) => {
      setSavingId(stagingId);
      setError(null);
      try {
        const resp = await fetch("/api/plaid/staging-update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stagingId, itemId, ...patch }),
        });
        const data = (await resp.json()) as { ok: boolean; error?: string };
        if (!data.ok) setError(data.error ?? "Save failed");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Save failed");
      } finally {
        setSavingId(null);
      }
    },
    [itemId],
  );

  const setAction = (row: StagedRowView, next: PlaidStagingAction) => {
    patchRow(row.stagingId, { proposedAction: next });
    void persist(row.stagingId, { proposedAction: next });
  };

  const setRemovalAction = async (row: RemovalRowView, next: PlaidStagingRemovalAction) => {
    setRemovals((prev) =>
      prev.map((r) => (r.plaidTransactionId === row.plaidTransactionId ? { ...r, proposedAction: next } : r)),
    );
    setSavingId(row.plaidTransactionId);
    setError(null);
    try {
      const resp = await fetch("/api/plaid/staging-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plaidTransactionId: row.plaidTransactionId,
          itemId,
          proposedAction: next,
        }),
      });
      const data = (await resp.json()) as { ok: boolean; error?: string };
      if (!data.ok) setError(data.error ?? "Save failed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSavingId(null);
    }
  };

  const bulkRemovalAction = async (action: PlaidStagingRemovalAction) => {
    if (removals.length === 0) return;
    const targets = removals.slice();
    setRemovals((prev) => prev.map((r) => ({ ...r, proposedAction: action })));
    for (const r of targets) {
      await setRemovalAction(r, action);
    }
  };

  const bulkAction = async (filter: (r: StagedRowView) => boolean, action: PlaidStagingAction) => {
    const targets = rows.filter(filter);
    if (targets.length === 0) return;
    setRows((prev) =>
      prev.map((r) => (filter(r) ? { ...r, proposedAction: action } : r)),
    );
    // Persist sequentially — staging batches are small enough that fanning out
    // isn't worth the complexity.
    for (const t of targets) {
      await persist(t.stagingId, { proposedAction: action });
    }
  };

  const onCommit = async () => {
    const removalsSummary =
      removals.length > 0
        ? `, delete ${deleteCount} (ignore ${ignoreRemovalCount})`
        : "";
    if (!confirm(`Commit ${keepCount} new, merge ${mergeCount}, skip ${skipCount}${removalsSummary}?`)) return;
    setCommitting(true);
    setError(null);
    try {
      const resp = await fetch("/api/plaid/commit-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId }),
      });
      const data = (await resp.json()) as {
        ok: boolean;
        error?: string;
        added?: number;
        matched?: number;
        merged?: number;
        skipped?: number;
        mergeBackfillSkipped?: number;
        deleted?: number;
        ignoredRemovals?: number;
      };
      if (!data.ok) {
        setError(data.error ?? "Commit failed");
        setCommitting(false);
        return;
      }
      const summary =
        `Committed: ${data.added ?? 0} new, ${data.matched ?? 0} already in DB, ` +
        `${data.merged ?? 0} merged (${data.mergeBackfillSkipped ?? 0} backfill skipped), ` +
        `${data.skipped ?? 0} skipped, ` +
        `${data.deleted ?? 0} deleted (${data.ignoredRemovals ?? 0} removal ignored).`;
      alert(summary);
      if (onAfterCommit) {
        onAfterCommit();
      } else {
        router.push("/settings/plaid");
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Commit failed");
      setCommitting(false);
    }
  };

  const onDiscard = async () => {
    if (!confirm("Discard all staged rows? Cursor stays at its previous value, so the next sync re-pulls the same window.")) return;
    setDiscarding(true);
    setError(null);
    try {
      const resp = await fetch("/api/plaid/discard-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId }),
      });
      const data = (await resp.json()) as { ok: boolean; error?: string };
      if (!data.ok) {
        setError(data.error ?? "Discard failed");
        setDiscarding(false);
        return;
      }
      if (onAfterDiscard) {
        onAfterDiscard();
      } else {
        router.push("/settings/plaid");
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Discard failed");
      setDiscarding(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <style>{`
        .plaid-review-amount::-webkit-outer-spin-button,
        .plaid-review-amount::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        .plaid-review-amount { -moz-appearance: textfield; appearance: textfield; }
        .plaid-review-grow { field-sizing: content; overflow: hidden; resize: none; }
      `}</style>
      <div
        style={{
          position: "sticky",
          top: 54,
          background: "#fff",
          padding: "0.75rem 1rem",
          borderBottom: "1px solid rgba(0,0,0,0.1)",
          display: "flex",
          alignItems: "center",
          gap: 12,
          zIndex: 10,
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontSize: 14 }}>
          <strong style={{ color: "#15803d" }}>{keepCount}</strong> keep ·{" "}
          <strong style={{ color: "#b45309" }}>{mergeCount}</strong> merge ·{" "}
          <strong style={{ opacity: 0.6 }}>{skipCount}</strong> skip
          {removals.length > 0 && (
            <>
              {" · "}
              <strong style={{ color: "#b91c1c" }}>{deleteCount}</strong> delete ·{" "}
              <strong style={{ opacity: 0.6 }}>{ignoreRemovalCount}</strong> ignore
            </>
          )}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {showSaving && <span style={{ fontSize: 12, opacity: 0.6 }}>Saving…</span>}
          {error && <span style={{ fontSize: 13, color: "#dc2626" }}>{error}</span>}
          <button
            type="button"
            onClick={onDiscard}
            disabled={committing || discarding}
            style={dangerBtn(committing || discarding)}
          >
            {discarding ? "Discarding…" : "Discard batch"}
          </button>
          <button
            type="button"
            onClick={onCommit}
            disabled={committing || discarding}
            style={primaryBtn(committing || discarding)}
          >
            {committing ? "Committing…" : "Commit"}
          </button>
        </div>
      </div>

      {fresh.length > 0 && (
        <Section
          title={`New transactions (${fresh.length})`}
          subtitle="No duplicate match. Default action: keep."
          extraActions={
            <>
              <button type="button" style={mutedBtn} onClick={() => bulkAction((r) => !r.flagReason, "keep")}>
                Keep all
              </button>
              <button type="button" style={mutedBtn} onClick={() => bulkAction((r) => !r.flagReason, "skip")}>
                Skip all
              </button>
            </>
          }
        >
          <RowTable
            rows={fresh}
            matchedById={matchedById}
            categories={categories}
            profiles={profiles}
            savingId={showSaving ? savingId : null}
            patchRow={patchRow}
            persist={persist}
            setAction={setAction}
            canonicalOptions={canonicalSuggestions}
            customOptions={customSuggestions}
            customByCanonical={customByCanonical}
            actions="keepSkip"
          />
        </Section>
      )}

      {autoResolved.length > 0 && (
        <Section
          title={`Pending → posted (${autoResolved.length})`}
          subtitle="Plaid said an existing pending charge has now posted with a new id. Default action: keep — committing this row deletes the original pending and inserts the posted version in its place, preserving your edits, refund/duplicate links, and tags."
          extraActions={
            <>
              <button type="button" style={mutedBtn} onClick={() => bulkAction((r) => !!r.replacesTransactionId, "keep")}>
                Keep all
              </button>
              <button type="button" style={mutedBtn} onClick={() => bulkAction((r) => !!r.replacesTransactionId, "skip")}>
                Skip all
              </button>
            </>
          }
        >
          <RowTable
            rows={autoResolved}
            matchedById={matchedById}
            categories={categories}
            profiles={profiles}
            savingId={showSaving ? savingId : null}
            patchRow={patchRow}
            persist={persist}
            setAction={setAction}
            canonicalOptions={canonicalSuggestions}
            customOptions={customSuggestions}
            customByCanonical={customByCanonical}
            actions="all"
          />
        </Section>
      )}

      {removals.length > 0 && (
        <Section
          title={`Removed by Plaid (${removals.length})`}
          subtitle="Plaid says these transactions no longer exist on its side — but we couldn't pair them with an incoming posted replacement in this batch (if we could, they'd be in 'Pending → posted' above). Default action: delete the local row; ignore if you'd rather keep it until a future sync re-posts the charge."
          extraActions={
            <>
              <button type="button" style={mutedBtn} onClick={() => bulkRemovalAction("delete")}>
                Delete all
              </button>
              <button type="button" style={mutedBtn} onClick={() => bulkRemovalAction("ignore")}>
                Ignore all
              </button>
            </>
          }
        >
          <RemovalTable
            rows={removals}
            savingId={showSaving ? savingId : null}
            setAction={setRemovalAction}
          />
        </Section>
      )}

      {flagged.length > 0 && (
        <Section
          title={`Probable duplicates (${flagged.length})`}
          subtitle="Matched an existing transaction on same account + exact amount + ±3 days. Default action: merge (don't re-insert; backfill plaidTransactionId onto the existing row)."
          extraActions={
            <>
              <button type="button" style={mutedBtn} onClick={() => bulkAction((r) => !!r.flagReason, "keep")}>
                Keep all
              </button>
              <button type="button" style={mutedBtn} onClick={() => bulkAction((r) => !!r.flagReason, "skip")}>
                Skip all
              </button>
              <button type="button" style={mutedBtn} onClick={() => bulkAction((r) => !!r.flagReason, "merge")}>
                Merge all
              </button>
            </>
          }
        >
          <RowTable
            rows={flagged}
            matchedById={matchedById}
            categories={categories}
            profiles={profiles}
            savingId={showSaving ? savingId : null}
            patchRow={patchRow}
            persist={persist}
            setAction={setAction}
            canonicalOptions={canonicalSuggestions}
            customOptions={customSuggestions}
            customByCanonical={customByCanonical}
            actions="all"
          />
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  subtitle,
  extraActions,
  children,
}: {
  title: string;
  subtitle?: string;
  extraActions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section style={{ border: "1px solid rgba(0,0,0,0.1)", borderRadius: 8, background: "#fff" }}>
      <header
        style={{
          padding: "0.75rem 1rem",
          borderBottom: "1px solid rgba(0,0,0,0.08)",
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{title}</div>
          {subtitle && <div style={{ fontSize: 12, opacity: 0.6 }}>{subtitle}</div>}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>{extraActions}</div>
      </header>
      <div style={{ overflowX: "auto" }}>{children}</div>
    </section>
  );
}

interface RowTableProps {
  rows: StagedRowView[];
  matchedById: Record<string, MatchedTxnView>;
  categories: string[];
  profiles: Profile[];
  savingId: string | null;
  patchRow: (id: string, patch: Partial<StagedRowView>) => void;
  persist: (id: string, patch: Partial<StagedRowView>) => Promise<void>;
  setAction: (row: StagedRowView, next: PlaidStagingAction) => void;
  canonicalOptions: string[];
  customOptions: string[];
  customByCanonical: Record<string, string[]>;
  /**
   * "keepSkip" — New transactions (no possible merge target): Keep / Skip only.
   * "all" — Pending→posted + Probable duplicates: Keep / Skip / Merge.
   */
  actions: "keepSkip" | "all";
}

function RowTable({
  rows,
  matchedById,
  categories,
  profiles,
  savingId,
  patchRow,
  persist,
  setAction,
  canonicalOptions,
  customOptions,
  customByCanonical,
  actions,
}: RowTableProps) {
  // Canonical defaults to the raw Plaid name (so the box is never blank), but
  // the user must be able to clear it. Track rows whose canonical was actively
  // emptied so the default doesn't immediately refill it. Cleared on re-typing.
  const [clearedCanonical, setClearedCanonical] = useState<Set<string>>(() => new Set());
  const markCanonicalCleared = (stagingId: string, cleared: boolean) =>
    setClearedCanonical((prev) => {
      if (prev.has(stagingId) === cleared) return prev;
      const next = new Set(prev);
      if (cleared) next.add(stagingId);
      else next.delete(stagingId);
      return next;
    });
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, tableLayout: "fixed" }}>
      <colgroup>
        <col style={{ width: 120 }} />
        <col />
        <col style={{ width: 75 }} />
        <col style={{ width: 160 }} />
        <col style={{ width: 190 }} />
        <col style={{ width: 160 }} />
        <col style={{ width: 160 }} />
        <col style={{ width: 80 }} />
      </colgroup>
      <thead>
        <tr style={{ textAlign: "left", borderBottom: "1px solid rgba(0,0,0,0.08)", background: "#fafafa" }}>
          <th style={th}>Date</th>
          <th style={th}>Canonical name</th>
          <th style={{ ...th, textAlign: "right" }}>Amount</th>
          <th style={th}>Category</th>
          <th style={th}>Account / profile</th>
          <th style={th}>Custom name</th>
          <th style={th}>Note</th>
          <th style={th}>Action</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const match = row.matchedTransactionId ? matchedById[row.matchedTransactionId] : null;
          const replacing = row.replacesTransactionId ? matchedById[row.replacesTransactionId] : null;
          const dim = row.proposedAction === "skip" ? 0.45 : 1;
          // Canonical name is ALWAYS shown (defaults to the raw Plaid name). We
          // only persist a value when it differs from the raw name; equal-to-raw
          // (or cleared) persists null, so the box stays a pure default and falls
          // back to the placeholder when emptied.
          // Pre-fill a name/category box ONLY when something is actively changing
          // it — a rule, or a saved merchant alias. Otherwise leave it empty so the
          // placeholder shows (committing an empty box writes no override). Rule
          // values win and the field is read-only, because rules override staged
          // values at commit anyway.
          const ruleCanonical = row.rulePreview?.effects.canonicalName;
          const ruleCategory = row.rulePreview?.effects.category;
          const ruleCustom = row.rulePreview?.effects.customName;
          // Canonical name is ALWAYS shown filled in (rule > alias/override >
          // raw Plaid name) so the user can see exactly what will be committed —
          // unless they've deliberately cleared it.
          const canonicalValue =
            ruleCanonical ??
            row.canonicalName ??
            (clearedCanonical.has(row.stagingId) ? "" : row.name);
          const categoryValue = ruleCategory ?? row.category;
          const customValue = ruleCustom ?? row.customName ?? "";
          // A purple (rule) / blue (alias) highlight appears ONLY when that
          // source actually OVERWRITES Plaid's original value — never when it
          // merely restates it. Both are measured against Plaid's value, and a
          // rule wins over an alias (rule purple suppresses the alias blue), so
          // a rule that duplicates an alias still owns the field and the alias
          // becomes redundant.
          const canonicalByRule = ruleCanonical != null && norm(ruleCanonical) !== norm(row.name);
          const canonicalByAlias =
            !canonicalByRule &&
            row.canonicalSource != null &&
            norm(row.canonicalName) !== norm(row.name);
          const plaidCategoryBase = row.plaidCategory ?? row.category;
          const categoryByRule = ruleCategory != null && norm(ruleCategory) !== norm(plaidCategoryBase);
          const categoryByAlias = !categoryByRule && row.categorySource === "alias";
          const customByRule = ruleCustom != null && norm(ruleCustom) !== norm(row.customName);
          // Fields the alias actively changes (after rules win). Drives the blue
          // "merchant alias" badge + its hover tooltip.
          const aliasChanges: string[] = [];
          if (canonicalByAlias) aliasChanges.push(`Canonical name → "${row.canonicalName ?? ""}"`);
          if (categoryByAlias) aliasChanges.push(`Category → ${row.category || "Uncategorized"}`);
          // Float the custom names historically tied to the current canonical
          // name to the top of the Custom name dropdown, the rest below.
          const relatedCustom = customByCanonical[canonicalValue.trim().toLowerCase()] ?? [];
          const relatedLower = new Set(relatedCustom.map((s) => s.toLowerCase()));
          const orderedCustomOptions = [
            ...relatedCustom,
            ...customOptions.filter((c) => !relatedLower.has(c.toLowerCase())),
          ];
          return (
            <tr
              key={row.stagingId}
              style={{
                borderBottom: "1px solid rgba(0,0,0,0.05)",
                opacity: dim,
                background: savingId === row.stagingId ? "#fef9c3" : "transparent",
              }}
            >
              {/* Date */}
              <td style={td}>
                <input
                  type="date"
                  value={row.originalDate || row.date}
                  onChange={(e) => patchRow(row.stagingId, { originalDate: e.target.value })}
                  onBlur={(e) => void persist(row.stagingId, { originalDate: e.target.value })}
                  style={{ ...inputBase, width: "100%" }}
                />
                {row.replacesTransactionId && (
                  <div
                    style={{ fontSize: 11, color: "#7c3aed", marginTop: 2, fontWeight: 600 }}
                    title="Swipe day inherited from the pending row this transaction replaces (Plaid's posted authorized_date is often a day or two later)."
                  >
                    ✨ swipe day from pending
                  </div>
                )}
              </td>
              {/* Canonical name */}
              <td style={td}>
                <SuggestInput
                  value={canonicalValue}
                  placeholder={row.name}
                  options={canonicalOptions}
                  readOnly={canonicalByRule}
                  onChange={(v) => {
                    markCanonicalCleared(row.stagingId, v.trim() === "");
                    patchRow(row.stagingId, { canonicalName: v || null });
                  }}
                  onCommit={(v) => void persist(row.stagingId, { canonicalName: v || null })}
                  style={{
                    ...inputBase,
                    width: "100%",
                    ...(canonicalByRule ? rulePreviewInputStyle : {}),
                    ...(canonicalByAlias ? aliasPreviewInputStyle : {}),
                    ...(canonicalByRule ? { cursor: "default" } : {}),
                  }}
                />
                {/* Raw Plaid name + bank description — ALWAYS directly below the
                    box. Truncated (these get very long); a custom hover card
                    (250ms) shows the full text + curated Plaid fields. */}
                <RawDetailHover
                  merchantName={row.name}
                  description={row.description}
                  detail={row.rawDetail}
                >
                  {row.name}
                  {row.description ? ` · ${row.description}` : ""}
                </RawDetailHover>
                {/* Provenance hints stack: the purple rule badge (any matched
                    rule) and the blue alias line (whenever an alias actually
                    changes any field) are independent — both can show at once,
                    each tooltip listing what that source changes. */}
                {row.rulePreview && <RuleAppliedBadge preview={row.rulePreview} />}
                {aliasChanges.length > 0 && <AliasAppliedBadge changes={aliasChanges} />}
                {/* Suppressed when the blue "replaces local pending" line below is
                    shown — it says the same thing. Kept as a fallback (e.g. the
                    replaced local row no longer exists) and for real duplicates. */}
                {row.flagReason && !replacing && (
                  <div style={{ fontSize: 11, color: "#b45309", marginTop: 2 }}>
                    ⚠ {row.flagReason}
                  </div>
                )}
                {match && row.proposedAction === "merge" && (
                  <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>
                    → merging into existing: {match.name} · {match.date} · {match.category || "Uncategorized"}
                  </div>
                )}
                {replacing && (
                  <div style={{ fontSize: 11, color: "#b45309", marginTop: 2 }}>
                    → replaces local pending: {replacing.name} · {replacing.date} · {formatMoney(replacing.amount)}
                  </div>
                )}
              </td>
              {/* Amount */}
              <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                <input
                  type="number"
                  step="0.01"
                  className="plaid-review-amount"
                  value={row.amount}
                  onChange={(e) => patchRow(row.stagingId, { amount: Number(e.target.value) })}
                  onBlur={(e) => void persist(row.stagingId, { amount: Number(e.target.value) })}
                  style={{ ...inputBase, width: "100%", textAlign: "right" }}
                />
                <div style={{ fontSize: 11, opacity: 0.5, marginTop: 2 }}>
                  {formatMoney(row.amount)}
                </div>
              </td>
              {/* Category */}
              <td style={td}>
                <select
                  value={categoryValue}
                  disabled={categoryByRule}
                  onChange={(e) => {
                    patchRow(row.stagingId, { category: e.target.value });
                    void persist(row.stagingId, { category: e.target.value });
                  }}
                  style={{
                    ...inputBase,
                    width: "100%",
                    ...(categoryByRule ? rulePreviewInputStyle : {}),
                    ...(categoryByAlias ? aliasPreviewInputStyle : {}),
                  }}
                >
                  <option value="">(Uncategorized)</option>
                  {!categories.includes(categoryValue) && categoryValue && (
                    <option value={categoryValue}>{categoryValue}{ruleCategory == null ? " (new)" : ""}</option>
                  )}
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </td>
              {/* Account / profile */}
              <td style={td}>
                {/* Dropdown sits above the account text so it lines up inline
                    with the other column inputs. */}
                <select
                  value={row.profileId ?? ""}
                  onChange={(e) => {
                    const next = e.target.value || null;
                    patchRow(row.stagingId, { profileId: next });
                    // profile updates aren't persisted by staging-update yet;
                    // they're inherited from accountId at commit time.
                  }}
                  style={{ ...inputBase, width: "100%" }}
                  disabled
                  title="Profile is inherited from the account at commit time"
                >
                  <option value="">(inherit)</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName}
                    </option>
                  ))}
                </select>
                <div
                  style={{ fontSize: 12, marginTop: 3, whiteSpace: "normal", wordBreak: "break-word", lineHeight: 1.25 }}
                  title={row.accountLabel ?? "(no account)"}
                >
                  {row.accountLabel ?? "(no account)"}
                </div>
                {row.accountInstitution && (
                  <div style={{ fontSize: 11, opacity: 0.55, lineHeight: 1.2 }}>
                    {row.accountInstitution}
                  </div>
                )}
              </td>
              {/* Custom name */}
              <td style={td}>
                <SuggestInput
                  value={customValue}
                  placeholder="Custom name"
                  options={orderedCustomOptions}
                  priorityCount={relatedCustom.length}
                  readOnly={customByRule}
                  onChange={(v) => patchRow(row.stagingId, { customName: v || null })}
                  onCommit={(v) => void persist(row.stagingId, { customName: v || null })}
                  style={{
                    ...inputBase,
                    width: "100%",
                    ...(customByRule ? rulePreviewInputStyle : {}),
                    ...(customByRule ? { cursor: "default" } : {}),
                  }}
                />
              </td>
              {/* Note */}
              <td style={td}>
                <textarea
                  className="plaid-review-grow"
                  rows={1}
                  value={row.note}
                  placeholder="Note"
                  onChange={(e) => patchRow(row.stagingId, { note: e.target.value })}
                  onBlur={(e) => void persist(row.stagingId, { note: e.target.value })}
                  style={{ ...inputBase, width: "100%", minHeight: 24, verticalAlign: "top" }}
                />
              </td>
              {/* Action */}
              <td style={td}>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <ActionBtn
                    label="Keep"
                    color="#15803d"
                    active={row.proposedAction === "keep"}
                    onClick={() => setAction(row, "keep")}
                  />
                  <ActionBtn
                    label="Skip"
                    color="#6b7280"
                    active={row.proposedAction === "skip"}
                    onClick={() => setAction(row, "skip")}
                  />
                  {actions === "all" && (
                    <ActionBtn
                      label="Merge"
                      color="#b45309"
                      active={row.proposedAction === "merge"}
                      disabled={!row.matchedTransactionId}
                      onClick={() => setAction(row, "merge")}
                    />
                  )}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

interface RemovalTableProps {
  rows: RemovalRowView[];
  savingId: string | null;
  setAction: (row: RemovalRowView, next: PlaidStagingRemovalAction) => void;
}

function RemovalTable({ rows, savingId, setAction }: RemovalTableProps) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, tableLayout: "fixed" }}>
      <colgroup>
        <col style={{ width: 110 }} />
        <col />
        <col style={{ width: 120 }} />
        <col style={{ width: 180 }} />
      </colgroup>
      <thead>
        <tr style={{ textAlign: "left", borderBottom: "1px solid rgba(0,0,0,0.08)", background: "#fafafa" }}>
          <th style={th}>Date</th>
          <th style={th}>Local row</th>
          <th style={{ ...th, textAlign: "right" }}>Amount</th>
          <th style={th}>Action</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const dim = row.proposedAction === "ignore" ? 0.55 : 1;
          return (
            <tr
              key={row.plaidTransactionId}
              style={{
                borderBottom: "1px solid rgba(0,0,0,0.05)",
                opacity: dim,
                background: savingId === row.plaidTransactionId ? "#fef9c3" : "transparent",
              }}
            >
              <td style={td}>{row.matchedDate}</td>
              <td style={td}>
                <div>{row.matchedName}</div>
                {row.replacementHint ? (
                  <div
                    style={{
                      fontSize: "0.75rem",
                      color: "#b45309",
                      marginTop: 2,
                    }}
                    title="Same account + exact amount + within 5 days of an incoming row in this batch — probably the pending→posted transition."
                  >
                    ⚠ {row.replacementHint}
                  </div>
                ) : (
                  <div
                    style={{
                      fontSize: "0.75rem",
                      opacity: 0.5,
                      marginTop: 2,
                    }}
                    title="Plaid removed this transaction but no replacement was found in this batch. This usually means the charge will re-post in a future sync. Keeping your local copy is the safe default."
                  >
                    No replacement found — keeping local copy is safe
                  </div>
                )}
              </td>
              <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {formatMoney(row.matchedAmount)}
              </td>
              <td style={td}>
                <div style={{ display: "flex", gap: 4 }}>
                  <ActionBtn
                    label="Delete"
                    color="#b91c1c"
                    active={row.proposedAction === "delete"}
                    onClick={() => setAction(row, "delete")}
                  />
                  <ActionBtn
                    label="Ignore"
                    color="#6b7280"
                    active={row.proposedAction === "ignore"}
                    onClick={() => setAction(row, "ignore")}
                  />
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * Text input with a click-to-open suggestion dropdown.
 *
 * Unlike a native <datalist> (which filters strictly by the current value, so
 * you must clear the box to see the full list), focusing or clicking the ▾
 * shows the WHOLE list; the list only filters once the user starts typing.
 * The dropdown is rendered with `position: fixed` so the section's horizontal
 * `overflow: auto` wrapper can't clip it. Read-only mode (rule-governed field)
 * renders a plain input with no dropdown.
 */
function SuggestInput({
  value,
  placeholder,
  options,
  priorityCount = 0,
  readOnly = false,
  style,
  onChange,
  onCommit,
}: {
  value: string;
  placeholder: string;
  options: string[];
  /**
   * Number of leading `options` that are "related" (e.g. custom names tied to
   * the current canonical name). A subtle divider is drawn after them in the
   * full (unfiltered) list.
   */
  priorityCount?: number;
  readOnly?: boolean;
  style?: React.CSSProperties;
  onChange: (v: string) => void;
  onCommit: (v: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  // false right after focus/▾ (show the full list); true once the user types
  // (filter by the current value).
  const [filtering, setFiltering] = useState(false);
  const [active, setActive] = useState(-1);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);

  const openList = (filter: boolean) => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (r) setRect({ left: r.left, top: r.bottom, width: r.width });
    setFiltering(filter);
    setActive(-1);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      // Ignore interactions inside the input wrapper or the (portaled-by-fixed)
      // dropdown — e.g. clicking/dragging the dropdown's own scrollbar, which
      // would otherwise fire a scroll/mousedown and slam the menu shut.
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || listRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    // Fixed-positioned dropdown can't follow a page scroll — close it (but the
    // guard above keeps scrolling the dropdown itself from closing it).
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  if (readOnly) {
    return <input type="text" value={value} placeholder={placeholder} readOnly style={style} />;
  }

  const q = value.trim().toLowerCase();
  const shown = (filtering && q
    ? options.filter((o) => o.toLowerCase().includes(q))
    : options
  ).slice(0, 50);
  // The divider only makes sense in the full, unfiltered list.
  const dividerAfter = !filtering && priorityCount > 0 && priorityCount < shown.length ? priorityCount : -1;

  const select = (opt: string) => {
    onChange(opt);
    onCommit(opt);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) return openList(false);
      setActive((i) => Math.min(i + 1, shown.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (open) setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (open && active >= 0 && active < shown.length) {
        e.preventDefault();
        select(shown[active]);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
    }
  };

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          openList(true);
        }}
        onFocus={() => openList(false)}
        onBlur={(e) => onCommit(e.target.value)}
        onKeyDown={onKeyDown}
        style={{ ...style, paddingRight: 18 }}
      />
      <span
        onMouseDown={(e) => {
          e.preventDefault();
          if (open) setOpen(false);
          else openList(false);
        }}
        style={{
          position: "absolute",
          right: 5,
          top: 0,
          bottom: 0,
          display: "flex",
          alignItems: "center",
          fontSize: 9,
          opacity: 0.5,
          cursor: "pointer",
          userSelect: "none",
        }}
        aria-hidden
      >
        ▾
      </span>
      {open && shown.length > 0 && rect && (
        <div
          ref={listRef}
          style={{
            position: "fixed",
            left: rect.left,
            top: rect.top + 2,
            width: rect.width,
            maxHeight: 240,
            overflowY: "auto",
            background: "#fff",
            border: "1px solid rgba(0,0,0,0.18)",
            borderRadius: 4,
            boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
            zIndex: 1000,
            fontSize: 12,
          }}
        >
          {shown.map((opt, idx) => (
            <div
              key={opt}
              ref={idx === active ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
              onMouseDown={(e) => {
                e.preventDefault();
                select(opt);
              }}
              onMouseEnter={() => setActive(idx)}
              style={{
                padding: "4px 8px",
                cursor: "pointer",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                background: idx === active ? "#eff6ff" : "transparent",
                borderBottom: idx === dividerAfter - 1 ? "1px solid rgba(0,0,0,0.12)" : undefined,
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

function ActionBtn({
  label,
  color,
  active,
  disabled,
  onClick,
}: {
  label: string;
  color: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: 1,
        padding: "3px 6px",
        fontSize: 12,
        border: `1px solid ${active ? color : "rgba(0,0,0,0.15)"}`,
        background: active ? color : "#fff",
        color: active ? "#fff" : disabled ? "#9ca3af" : color,
        borderRadius: 4,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
  );
}

// Case/whitespace-insensitive compare used to decide whether a rule/alias value
// actually differs from the value it would otherwise overwrite.
const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

const th: React.CSSProperties = { padding: "8px 10px", fontWeight: 600, fontSize: 12 };
const td: React.CSSProperties = { padding: "8px 10px", verticalAlign: "top" };
const inputBase: React.CSSProperties = {
  // `font: inherit` so the Note <textarea> renders in the same UI font as the
  // <input>/<select> boxes (textarea defaults to a monospace-ish font).
  fontFamily: "inherit",
  fontSize: 12,
  padding: "3px 6px",
  borderRadius: 4,
  border: "1px solid rgba(0,0,0,0.2)",
  boxSizing: "border-box",
};
const mutedBtn: React.CSSProperties = {
  fontSize: 12,
  padding: "4px 10px",
  borderRadius: 4,
  border: "1px solid rgba(0,0,0,0.15)",
  background: "#fff",
  cursor: "pointer",
};

function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: "6px 14px",
    borderRadius: 6,
    border: "none",
    background: disabled ? "#9ca3af" : "#1a1f3a",
    color: "#fff",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: 14,
    fontWeight: 600,
  };
}

const rulePreviewInputStyle: React.CSSProperties = {
  border: "1px solid #a78bfa",
  boxShadow: "0 0 0 1px rgba(167,139,250,0.25)",
  background: "#faf5ff",
};

// Blue counterpart to the purple rule style — a merchant alias is filling this
// field. Unlike a rule, an alias is just a default, so the field stays editable.
const aliasPreviewInputStyle: React.CSSProperties = {
  border: "1px solid #7dd3fc",
  boxShadow: "0 0 0 1px rgba(125,211,252,0.25)",
  background: "#f0f9ff",
};

function RuleAppliedBadge({ preview }: { preview: RulePreview }) {
  const changes: string[] = [];
  const { effects } = preview;
  if (effects.category) changes.push(`Category → ${effects.category}`);
  if (effects.customName) changes.push(`Custom name → "${effects.customName}"`);
  if (effects.canonicalName) changes.push(`Canonical name → "${effects.canonicalName}"`);
  if (effects.excluded) changes.push("Excluded");
  if (effects.oneTime) changes.push("One-time");
  if (effects.addTags && effects.addTags.length > 0) {
    changes.push(`Tags → ${effects.addTags.join(", ")}`);
  }
  if (effects.removeTags && effects.removeTags.length > 0) {
    changes.push(`Remove tags → ${effects.removeTags.join(", ")}`);
  }

  // Only the rule name shows inline; the actual field changes live in the
  // hover tooltip (the changed fields are already pre-filled + purple above).
  const ruleLabel =
    preview.matched.length === 1
      ? `Rule: ${preview.matched[0].ruleName}`
      : `Rules: ${preview.matched.map((m) => m.ruleName).join(", ")}`;
  const ruleNames = preview.matched.map((m) => m.ruleName).join(", ");
  const tooltip =
    changes.length > 0
      ? `${ruleNames}\n${changes.map((c) => `• ${c}`).join("\n")}`
      : `${ruleNames}\n(no field changes from current staged values)`;

  return (
    <div
      title={tooltip}
      style={{
        fontSize: 11,
        color: "#7c3aed",
        fontWeight: 600,
        marginTop: 2,
        lineHeight: 1.3,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      ✨ {ruleLabel}
    </div>
  );
}

/**
 * The truncated gray "raw name · description" line, with a custom hover card
 * (250ms open delay) showing the full text plus the curated Plaid fields. Uses
 * a fixed-positioned card so the section's overflow wrapper can't clip it.
 */
function RawDetailHover({
  merchantName,
  description,
  detail,
  children,
}: {
  merchantName: string;
  description: string;
  detail: RawDetail | null;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // After the card mounts, clamp it up if it would spill past the bottom of the
  // viewport so its bottom edge rests at the bottom of the browser as a failsafe.
  useEffect(() => {
    if (!pos || !cardRef.current) return;
    const h = cardRef.current.offsetHeight;
    const maxTop = window.innerHeight - h - 8;
    const clamped = Math.max(8, Math.min(pos.top, maxTop));
    cardRef.current.style.top = `${clamped}px`;
  }, [pos]);

  const open = () => {
    timer.current = setTimeout(() => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      const width = 340;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      setPos({ left, top: r.bottom + 4 });
    }, 250);
  };
  const close = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setPos(null);
  };
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const rows: { label: string; value: string }[] = [];
  rows.push({ label: "Merchant name", value: merchantName || "—" });
  if (description) rows.push({ label: "Description", value: description });
  if (detail) {
    const authorized = detail.authorizedDatetime ?? detail.authorizedDate;
    if (authorized) rows.push({ label: "Authorized", value: authorized });
    if (detail.counterparties.length > 0) {
      rows.push({
        label: "Counterparties",
        value: detail.counterparties.map((c) => (c.type ? `${c.name} (${c.type})` : c.name)).join(", "),
      });
    }
    rows.push({ label: "Pending", value: detail.pending ? "yes" : "no" });
    if (!detail.pending && detail.pendingTransactionId) {
      rows.push({ label: "Replaces pending", value: detail.pendingTransactionId });
    }
    if (detail.paymentChannel) rows.push({ label: "Payment channel", value: detail.paymentChannel });
    const pm = detail.paymentMeta;
    if (pm) {
      const parts: string[] = [];
      if (pm.paymentMethod) parts.push(pm.paymentMethod);
      if (pm.paymentProcessor) parts.push(`via ${pm.paymentProcessor}`);
      if (pm.payer) parts.push(`payer ${pm.payer}`);
      if (pm.payee) parts.push(`payee ${pm.payee}`);
      if (pm.byOrderOf) parts.push(`by order of ${pm.byOrderOf}`);
      if (pm.reason) parts.push(`reason ${pm.reason}`);
      if (parts.length > 0) rows.push({ label: "Payment meta", value: parts.join(" · ") });
    }
    if (detail.referenceNumber) rows.push({ label: "Reference #", value: detail.referenceNumber });
  }

  return (
    <div
      ref={ref}
      onMouseEnter={open}
      onMouseLeave={close}
      style={{
        fontSize: 11,
        opacity: 0.55,
        marginTop: 2,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        cursor: "default",
      }}
    >
      {children}
      {pos &&
        createPortal(
          <div
            ref={cardRef}
            style={{
              position: "fixed",
              left: pos.left,
              top: pos.top,
              width: 340,
              background: "#1f2937",
              color: "#fff",
              borderRadius: 6,
              padding: "8px 10px",
              boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
              zIndex: 2000,
              fontSize: 11.5,
              lineHeight: 1.4,
              whiteSpace: "normal",
              pointerEvents: "none",
            }}
          >
            {rows.map((r) => (
              <div key={r.label} style={{ display: "flex", gap: 6, marginBottom: 2 }}>
                <span style={{ flex: "0 0 96px", opacity: 0.6 }}>{r.label}</span>
                <span style={{ flex: 1, wordBreak: "break-word" }}>{r.value}</span>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

function AliasAppliedBadge({ changes }: { changes: string[] }) {
  // Inline = just the source label; the field changes live in the hover
  // tooltip (mirrors RuleAppliedBadge, blue instead of purple).
  const tooltip = `Saved merchant alias\n${changes.map((c) => `• ${c}`).join("\n")}`;
  return (
    <div
      title={tooltip}
      style={{
        fontSize: 11,
        color: "#0369a1",
        fontWeight: 600,
        marginTop: 2,
        lineHeight: 1.3,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      from saved merchant alias
    </div>
  );
}

function dangerBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: "6px 12px",
    borderRadius: 6,
    border: "1px solid #fecaca",
    background: "#fff",
    color: disabled ? "#9ca3af" : "#b91c1c",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: 14,
  };
}
