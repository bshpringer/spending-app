"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePlaidLink, type PlaidLinkOnSuccessMetadata } from "react-plaid-link";
import { ReconcileModal, type PlaidAccountSummary } from "./ReconcileModal.tsx";
import { reorderBanks } from "./actions.ts";
import { FEATURES } from "@/lib/appMode.ts";

export interface BankItemView {
  itemId: string;
  institutionName: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  stagedCount: number;
  removalCount: number;
  referenceCount: number;
  earliestPlaidDate: string | null;
  linkedAccounts: { plaidAccountId: string; accountId: string; label: string }[];
}

export interface LocalAccountOption {
  id: string;
  label: string;
  institutionName: string;
  accountNumberLast4: string;
}

interface ExchangeResponse {
  ok: boolean;
  itemId?: string;
  institutionName?: string | null;
  accounts?: PlaidAccountSummary[];
  error?: string;
}

interface PendingReconcile {
  itemId: string;
  institutionName: string | null;
  accounts: PlaidAccountSummary[];
}

interface BanksClientProps {
  items: BankItemView[];
  localAccounts: LocalAccountOption[];
}

export function BanksClient({ items, localAccounts }: BanksClientProps) {
  const router = useRouter();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [pendingReconcile, setPendingReconcile] = useState<PendingReconcile | null>(null);
  const [syncingItemId, setSyncingItemId] = useState<string | null>(null);
  const [statusByItem, setStatusByItem] = useState<Record<string, string>>({});
  const [fromByItem, setFromByItem] = useState<Record<string, string>>({});
  const [toByItem, setToByItem] = useState<Record<string, string>>({});
  const [referenceBusyItem, setReferenceBusyItem] = useState<string | null>(null);
  const [backfillBusyItem, setBackfillBusyItem] = useState<string | null>(null);
  // Per-item Plaid sub-account scope for Backfill range. Empty string = "all
  // linked accounts" (no scope sent to Plaid). Non-empty = a single
  // plaidAccountId. Keeping this single-select (not multi) for simplicity —
  // the user can rerun the backfill per sub-account.
  const [backfillScopeByItem, setBackfillScopeByItem] = useState<Record<string, string>>({});
  const [rawBackfillBusy, setRawBackfillBusy] = useState(false);
  const [rawBackfillStatus, setRawBackfillStatus] = useState<string | null>(null);

  // Fetch a fresh link_token on mount. Plaid recommends a new token per session.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch("/api/plaid/link-token", { method: "POST" });
        const data = (await resp.json()) as { ok: boolean; link_token?: string; error?: string };
        if (cancelled) return;
        if (!data.ok || !data.link_token) {
          setLinkError(data.error ?? "Failed to create link token");
          return;
        }
        setLinkToken(data.link_token);
      } catch (err) {
        if (cancelled) return;
        setLinkError(err instanceof Error ? err.message : "Failed to create link token");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onLinkSuccess = useCallback(
    async (public_token: string, _metadata: PlaidLinkOnSuccessMetadata) => {
      try {
        const resp = await fetch("/api/plaid/exchange-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ public_token }),
        });
        const data = (await resp.json()) as ExchangeResponse;
        if (!data.ok || !data.itemId || !data.accounts) {
          setLinkError(data.error ?? "Failed to exchange token");
          return;
        }
        setPendingReconcile({
          itemId: data.itemId,
          institutionName: data.institutionName ?? null,
          accounts: data.accounts,
        });
      } catch (err) {
        setLinkError(err instanceof Error ? err.message : "Failed to exchange token");
      }
    },
    [],
  );

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: onLinkSuccess,
  });

  const onReconcileComplete = useCallback(() => {
    setPendingReconcile(null);
    router.refresh();
  }, [router]);

  const onSync = useCallback(
    async (itemId: string) => {
      setSyncingItemId(itemId);
      setStatusByItem((s) => ({ ...s, [itemId]: "Syncing…" }));
      // If the user hasn't manually picked a From date, fall back to the
      // item's lastSyncedAt so each Sync naturally picks up only what's new
      // since the previous successful one. Empty string in fromByItem means
      // "explicitly cleared" — respect it and send no filter.
      const item = items.find((i) => i.itemId === itemId);
      const fromOverride = fromByItem[itemId];
      const from =
        fromOverride !== undefined
          ? fromOverride || undefined
          : item?.lastSyncedAt
            ? item.lastSyncedAt.slice(0, 10)
            : undefined;
      const to = toByItem[itemId] || undefined;
      try {
        const resp = await fetch("/api/plaid/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemId, from, to }),
        });
        const data = (await resp.json()) as {
          ok: boolean;
          stagedCount?: number;
          flaggedCount?: number;
          removalCount?: number;
          error?: string;
        };
        if (!data.ok) {
          setStatusByItem((s) => ({ ...s, [itemId]: `Error: ${data.error ?? "unknown"}` }));
        } else if ((data.stagedCount ?? 0) === 0 && (data.removalCount ?? 0) === 0) {
          setStatusByItem((s) => ({ ...s, [itemId]: "Nothing new from Plaid." }));
          router.refresh();
        } else {
          router.push(`/settings/plaid/review/${itemId}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "sync failed";
        setStatusByItem((s) => ({ ...s, [itemId]: `Error: ${msg}` }));
      } finally {
        setSyncingItemId(null);
      }
    },
    [router, fromByItem, toByItem, items],
  );

  const onBackfill = useCallback(
    async (itemId: string) => {
      const from = (fromByItem[itemId] ?? "").trim();
      const to = (toByItem[itemId] ?? "").trim();
      if (!from || !to) {
        setStatusByItem((s) => ({
          ...s,
          [itemId]: "Set both From and To dates to backfill a range.",
        }));
        return;
      }
      const scopeId = (backfillScopeByItem[itemId] ?? "").trim();
      const plaidAccountIds = scopeId ? [scopeId] : undefined;
      const scopeLabel = (() => {
        if (!scopeId) return "";
        const item = items.find((i) => i.itemId === itemId);
        const acct = item?.linkedAccounts.find((a) => a.plaidAccountId === scopeId);
        return acct ? ` (${acct.label})` : "";
      })();
      setBackfillBusyItem(itemId);
      setStatusByItem((s) => ({ ...s, [itemId]: `Backfilling ${from} → ${to}${scopeLabel}…` }));
      try {
        const resp = await fetch("/api/plaid/historical-import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemId, from, to, plaidAccountIds }),
        });
        const data = (await resp.json()) as {
          ok: boolean;
          pulled?: number;
          stagedCount?: number;
          flaggedCount?: number;
          skippedNoAccount?: number;
          error?: string;
        };
        if (!data.ok) {
          setStatusByItem((s) => ({ ...s, [itemId]: `Error: ${data.error ?? "unknown"}` }));
          return;
        }
        const pulled = data.pulled ?? 0;
        const staged = data.stagedCount ?? 0;
        const skipped = data.skippedNoAccount ?? 0;
        if (staged === 0) {
          let msg: string;
          if (pulled === 0) {
            msg = `Plaid returned 0 transactions for ${from} → ${to}. Either there's nothing in that window, or Plaid hasn't finished the item's initial historical pull yet (new items can take hours; check back later).`;
          } else if (skipped > 0) {
            msg = `Plaid returned ${pulled} transactions but all ${skipped} belonged to sub-accounts that aren't linked locally. Reconcile the missing sub-accounts first.`;
          } else {
            msg = `Plaid returned ${pulled} transactions but none were staged. (Bug — check server logs.)`;
          }
          setStatusByItem((s) => ({ ...s, [itemId]: msg }));
          router.refresh();
          return;
        }
        setStatusByItem((s) => ({
          ...s,
          [itemId]: `Backfilled ${data.stagedCount ?? 0} transactions (${data.flaggedCount ?? 0} flagged as possible duplicates). Redirecting to review…`,
        }));
        router.push(`/settings/plaid/review/${itemId}`);
      } catch (err) {
        setStatusByItem((s) => ({
          ...s,
          [itemId]: `Error: ${err instanceof Error ? err.message : "backfill failed"}`,
        }));
      } finally {
        setBackfillBusyItem(null);
      }
    },
    [router, fromByItem, toByItem, backfillScopeByItem, items],
  );

  const onPullReference = useCallback(
    async (itemId: string, months: 6 | 12) => {
      setReferenceBusyItem(itemId);
      setStatusByItem((s) => ({ ...s, [itemId]: `Pulling ${months}-month reference…` }));
      try {
        const resp = await fetch("/api/plaid/reference-pull", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemId, months }),
        });
        const data = (await resp.json()) as {
          ok: boolean;
          pulled?: number;
          inserted?: number;
          error?: string;
        };
        if (!data.ok) {
          setStatusByItem((s) => ({ ...s, [itemId]: `Error: ${data.error ?? "unknown"}` }));
        } else {
          setStatusByItem((s) => ({
            ...s,
            [itemId]: `Pulled ${data.pulled ?? 0} reference transactions.`,
          }));
          router.refresh();
        }
      } catch (err) {
        setStatusByItem((s) => ({
          ...s,
          [itemId]: `Error: ${err instanceof Error ? err.message : "pull failed"}`,
        }));
      } finally {
        setReferenceBusyItem(null);
      }
    },
    [router],
  );

  const onDiscardReference = useCallback(
    async (itemId: string) => {
      if (!confirm("Discard all reference transactions for this bank? This does not affect committed transactions or saved aliases.")) {
        return;
      }
      setReferenceBusyItem(itemId);
      try {
        const resp = await fetch(`/api/plaid/reference-pull?itemId=${encodeURIComponent(itemId)}`, {
          method: "DELETE",
        });
        const data = (await resp.json()) as { ok: boolean; error?: string };
        if (!data.ok) {
          alert(`Discard failed: ${data.error ?? "unknown"}`);
          return;
        }
        router.refresh();
      } finally {
        setReferenceBusyItem(null);
      }
    },
    [router],
  );

  const onUnlink = useCallback(
    async (itemId: string) => {
      if (!confirm("Unlink this bank? Transactions already imported will be kept.")) return;
      try {
        const resp = await fetch("/api/plaid/unlink", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemId }),
        });
        const data = (await resp.json()) as { ok: boolean; error?: string };
        if (!data.ok) {
          alert(`Unlink failed: ${data.error ?? "unknown"}`);
          return;
        }
        router.refresh();
      } catch (err) {
        alert(`Unlink failed: ${err instanceof Error ? err.message : "unknown"}`);
      }
    },
    [router],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button
          type="button"
          disabled={!ready || !linkToken}
          onClick={() => open()}
          style={primaryButtonStyle(!ready || !linkToken)}
        >
          {linkToken ? "Connect a bank" : "Loading…"}
        </button>
        {FEATURES.migrationTooling && (
        <button
          type="button"
          disabled={rawBackfillBusy}
          onClick={async () => {
            setRawBackfillBusy(true);
            setRawBackfillStatus("Backfilling raw Plaid payloads…");
            try {
              const resp = await fetch("/api/plaid/backfill-raw", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
              });
              const data = (await resp.json()) as {
                summaries?: { institutionName: string | null; scanned: number; backfilled: number; remaining: number; error?: string }[];
                error?: string;
              };
              if (!resp.ok || !data.summaries) {
                setRawBackfillStatus(`Error: ${data.error ?? "backfill failed"}`);
              } else {
                const total = data.summaries.reduce(
                  (acc, s) => ({
                    scanned: acc.scanned + s.scanned,
                    backfilled: acc.backfilled + s.backfilled,
                    remaining: acc.remaining + s.remaining,
                  }),
                  { scanned: 0, backfilled: 0, remaining: 0 },
                );
                const perItem = data.summaries
                  .map((s) => {
                    const tag = s.error ? ` (error: ${s.error})` : "";
                    return `${s.institutionName ?? "(unnamed)"}: ${s.backfilled} backfilled / ${s.scanned} scanned${s.remaining > 0 ? ` · ${s.remaining} still missing` : ""}${tag}`;
                  })
                  .join(" · ");
                setRawBackfillStatus(
                  `Backfilled ${total.backfilled} rows (scanned ${total.scanned}${total.remaining > 0 ? `, ${total.remaining} still missing — Plaid no longer returns them` : ""}). ${perItem}`,
                );
              }
            } catch (err) {
              setRawBackfillStatus(
                `Error: ${err instanceof Error ? err.message : "backfill failed"}`,
              );
            } finally {
              setRawBackfillBusy(false);
            }
          }}
          style={secondaryButtonStyle(rawBackfillBusy)}
          title="Pull /transactions/get for every connected item and store the full raw payload on each existing Plaid-sourced row that doesn't have one yet. Idempotent; cursor untouched."
        >
          {rawBackfillBusy ? "Backfilling…" : "Backfill raw Plaid payloads"}
        </button>
        )}
        {linkError && <span style={{ color: "#dc2626", fontSize: 14 }}>{linkError}</span>}
        {rawBackfillStatus && (
          <span style={{ fontSize: 13, color: rawBackfillStatus.startsWith("Error") ? "#dc2626" : "#374151" }}>
            {rawBackfillStatus}
          </span>
        )}
      </div>

      {items.length === 0 ? (
        <p style={{ opacity: 0.7 }}>No banks connected yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {items.map((item, idx) => {
            const unreconciled = item.linkedAccounts.length === 0;
            const canMoveUp = idx > 0;
            const canMoveDown = idx < items.length - 1;
            const move = (dir: -1 | 1) => {
              const ids = items.map((i) => i.itemId);
              const target = idx + dir;
              if (target < 0 || target >= ids.length) return;
              [ids[idx], ids[target]] = [ids[target], ids[idx]];
              void reorderBanks(ids).then(() => router.refresh());
            };
            const hasStaged = item.stagedCount > 0 || item.removalCount > 0;
            const syncDisabled = syncingItemId === item.itemId || unreconciled || hasStaged;
            const syncTitle = unreconciled
              ? "Reconcile this bank's accounts before syncing"
              : hasStaged
                ? "Resolve the pending review batch before syncing again"
                : undefined;
            return (
              <div
                key={item.itemId}
                style={{
                  border: "1px solid rgba(0,0,0,0.1)",
                  borderRadius: 8,
                  padding: "1rem 1.25rem",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                  background: "#fff",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <button
                        type="button"
                        onClick={() => move(-1)}
                        disabled={!canMoveUp}
                        title="Move up"
                        style={reorderButtonStyle(!canMoveUp)}
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        onClick={() => move(1)}
                        disabled={!canMoveDown}
                        title="Move down"
                        style={reorderButtonStyle(!canMoveDown)}
                      >
                        ▼
                      </button>
                    </div>
                    <div>
                    <div style={{ fontSize: 18, fontWeight: 600 }}>
                      {item.institutionName ?? "(unknown institution)"}
                    </div>
                    <div style={{ fontSize: 13, opacity: 0.65 }}>
                      {item.lastSyncedAt
                        ? `Last sync: ${formatRelative(item.lastSyncedAt)}`
                        : "Never synced"}
                    </div>
                    <div
                      style={{ fontSize: 12, opacity: 0.55 }}
                      title="Earliest Plaid-sourced transaction we've seen for this Item. /transactions/get won't return anything older than this — relink the Item to widen the window."
                    >
                      {item.earliestPlaidDate
                        ? `History reaches back to ${item.earliestPlaidDate}`
                        : "No Plaid transactions yet for this Item"}
                    </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      disabled={syncDisabled}
                      onClick={() => onSync(item.itemId)}
                      style={secondaryButtonStyle(syncDisabled)}
                      title={syncTitle}
                    >
                      {syncingItemId === item.itemId ? "Syncing…" : "Sync now"}
                    </button>
                    <button
                      type="button"
                      onClick={() => onUnlink(item.itemId)}
                      style={dangerButtonStyle}
                    >
                      Unlink
                    </button>
                  </div>
                </div>
                {hasStaged && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "8px 12px",
                      borderRadius: 6,
                      background: "#fef3c7",
                      border: "1px solid #fde68a",
                      fontSize: 14,
                    }}
                  >
                    <span>
                      {item.stagedCount > 0 && (
                        <>
                          <strong>{item.stagedCount}</strong>{" "}
                          add{item.stagedCount === 1 ? "" : "s"}
                        </>
                      )}
                      {item.stagedCount > 0 && item.removalCount > 0 && " · "}
                      {item.removalCount > 0 && (
                        <>
                          <strong>{item.removalCount}</strong>{" "}
                          removal{item.removalCount === 1 ? "" : "s"}
                        </>
                      )}{" "}
                      staged for review.
                    </span>
                    <Link
                      href={`/settings/plaid/review/${item.itemId}`}
                      style={{ marginLeft: "auto", color: "#1a1f3a", fontWeight: 600 }}
                    >
                      Review now →
                    </Link>
                  </div>
                )}
                {!unreconciled && FEATURES.migrationTooling && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginTop: 2,
                      flexWrap: "wrap",
                      fontSize: 13,
                    }}
                  >
                    <span style={{ opacity: 0.7, whiteSpace: "nowrap" }}>
                      Reference pull (for merchant reconciliation):
                    </span>
                    <button
                      type="button"
                      disabled={referenceBusyItem === item.itemId}
                      onClick={() => onPullReference(item.itemId, 6)}
                      style={secondaryButtonStyle(referenceBusyItem === item.itemId)}
                    >
                      Pull 6 mo
                    </button>
                    <button
                      type="button"
                      disabled={referenceBusyItem === item.itemId}
                      onClick={() => onPullReference(item.itemId, 12)}
                      style={secondaryButtonStyle(referenceBusyItem === item.itemId)}
                    >
                      Pull 12 mo
                    </button>
                    {item.referenceCount > 0 && (
                      <>
                        <span style={{ opacity: 0.75 }}>
                          {item.referenceCount} reference rows
                        </span>
                        <button
                          type="button"
                          disabled={referenceBusyItem === item.itemId}
                          onClick={() => onDiscardReference(item.itemId)}
                          style={{
                            ...dangerButtonStyle,
                            padding: "4px 10px",
                            fontSize: 13,
                          }}
                        >
                          Discard
                        </button>
                      </>
                    )}
                  </div>
                )}
                {!unreconciled && !hasStaged && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, opacity: 0.7, whiteSpace: "nowrap" }}>
                      Date filter (optional):
                    </span>
                    <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ opacity: 0.7 }}>From</span>
                      <input
                        type="date"
                        value={
                          fromByItem[item.itemId] ??
                          (item.lastSyncedAt ? item.lastSyncedAt.slice(0, 10) : "")
                        }
                        onChange={(e) =>
                          setFromByItem((s) => ({ ...s, [item.itemId]: e.target.value }))
                        }
                        title="Defaults to the date of the most recent successful sync — only newer transactions are kept."
                        style={{
                          fontSize: 13,
                          padding: "3px 6px",
                          borderRadius: 4,
                          border: "1px solid rgba(0,0,0,0.2)",
                        }}
                      />
                    </label>
                    <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ opacity: 0.7 }}>To</span>
                      <input
                        type="date"
                        value={toByItem[item.itemId] ?? ""}
                        onChange={(e) =>
                          setToByItem((s) => ({ ...s, [item.itemId]: e.target.value }))
                        }
                        style={{
                          fontSize: 13,
                          padding: "3px 6px",
                          borderRadius: 4,
                          border: "1px solid rgba(0,0,0,0.2)",
                        }}
                      />
                    </label>
                    {(fromByItem[item.itemId] !== undefined ||
                      toByItem[item.itemId] ||
                      item.lastSyncedAt) && (
                      <button
                        type="button"
                        onClick={() => {
                          // Empty-string sentinel = "user explicitly cleared":
                          // overrides the lastSyncedAt default so a fresh full
                          // pull happens on the next Sync.
                          setFromByItem((s) => ({ ...s, [item.itemId]: "" }));
                          setToByItem((s) => { const n = { ...s }; delete n[item.itemId]; return n; });
                        }}
                        style={{
                          fontSize: 13,
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          opacity: 0.6,
                          padding: "0 2px",
                        }}
                      >
                        Clear
                      </button>
                    )}
                    {(() => {
                      const from = (fromByItem[item.itemId] ?? "").trim();
                      const to = (toByItem[item.itemId] ?? "").trim();
                      const ready = Boolean(from) && Boolean(to);
                      const busy = backfillBusyItem === item.itemId;
                      const disabled = !ready || busy || syncingItemId !== null;
                      const scopeId = backfillScopeByItem[item.itemId] ?? "";
                      return (
                        <span style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
                          <label
                            style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 4 }}
                            title="Backfill all linked sub-accounts on this Item, or scope to a single one to make the review focused."
                          >
                            <span style={{ opacity: 0.7 }}>Scope</span>
                            <select
                              value={scopeId}
                              onChange={(e) =>
                                setBackfillScopeByItem((s) => ({
                                  ...s,
                                  [item.itemId]: e.target.value,
                                }))
                              }
                              disabled={busy}
                              style={{
                                fontSize: 13,
                                padding: "3px 6px",
                                borderRadius: 4,
                                border: "1px solid rgba(0,0,0,0.2)",
                                maxWidth: 220,
                              }}
                            >
                              <option value="">All accounts</option>
                              {item.linkedAccounts.map((a) => (
                                <option key={a.plaidAccountId} value={a.plaidAccountId}>
                                  {a.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button
                            type="button"
                            disabled={disabled}
                            onClick={() => onBackfill(item.itemId)}
                            title={
                              ready
                                ? "Pull every transaction in this date range via /transactions/get (cursor untouched) and stage for review."
                                : "Set both From and To to enable historical backfill."
                            }
                            style={{
                              fontSize: 13,
                              padding: "4px 10px",
                              borderRadius: 4,
                              border: "1px solid rgba(0,0,0,0.2)",
                              background: disabled ? "rgba(0,0,0,0.04)" : "#f9fafb",
                              cursor: disabled ? "not-allowed" : "pointer",
                              opacity: disabled ? 0.55 : 1,
                            }}
                          >
                            {busy ? "Backfilling…" : "Backfill range"}
                          </button>
                        </span>
                      );
                    })()}
                  </div>
                )}
                {unreconciled && (
                  <div style={{ fontSize: 13, color: "#b45309" }}>
                    Pending reconciliation — link this bank&apos;s accounts to local accounts before
                    syncing. (Refresh the page or reconnect to pick up the reconciliation prompt.)
                  </div>
                )}
                {item.linkedAccounts.length > 0 && (
                  <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: 14, opacity: 0.85 }}>
                    {item.linkedAccounts.map((la) => (
                      <li key={la.plaidAccountId}>{la.label}</li>
                    ))}
                  </ul>
                )}
                {statusByItem[item.itemId] && (
                  <div style={{ fontSize: 13, opacity: 0.8 }}>{statusByItem[item.itemId]}</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {pendingReconcile && (
        <ReconcileModal
          itemId={pendingReconcile.itemId}
          institutionName={pendingReconcile.institutionName}
          plaidAccounts={pendingReconcile.accounts}
          localAccounts={localAccounts}
          onClose={() => setPendingReconcile(null)}
          onComplete={onReconcileComplete}
        />
      )}
    </div>
  );
}

function primaryButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "8px 16px",
    borderRadius: 6,
    border: "none",
    background: disabled ? "#9ca3af" : "#1a1f3a",
    color: "#fff",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: 15,
    fontWeight: 600,
  };
}

function reorderButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    width: 22,
    height: 18,
    padding: 0,
    borderRadius: 4,
    border: "1px solid rgba(0,0,0,0.12)",
    background: disabled ? "#f3f4f6" : "#fff",
    color: disabled ? "#cbd5e1" : "#475569",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: 10,
    lineHeight: "16px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };
}

function secondaryButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "6px 12px",
    borderRadius: 6,
    border: "1px solid rgba(0,0,0,0.15)",
    background: disabled ? "#f3f4f6" : "#fff",
    color: disabled ? "#9ca3af" : "#111",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: 14,
  };
}

const dangerButtonStyle: React.CSSProperties = {
  padding: "6px 12px",
  borderRadius: 6,
  border: "1px solid #fecaca",
  background: "#fff",
  color: "#b91c1c",
  cursor: "pointer",
  fontSize: 14,
};

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
