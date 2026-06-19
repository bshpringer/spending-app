"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

export interface SyncItem {
  itemId: string;
  institutionName: string | null;
  lastSyncedAt: string | null;
  stagedCount: number;
  removalCount: number;
}

interface Props {
  items: SyncItem[];
}

interface PerItemResult {
  itemId: string;
  institutionName: string | null;
  status:
    | { kind: "staged"; stagedCount: number; removalCount: number }
    | { kind: "empty" }
    | { kind: "already-pending" }
    | { kind: "error"; message: string };
}

export function SyncAllButton({ items }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [results, setResults] = useState<PerItemResult[] | null>(null);
  // Short outcome shown in the same inline spot as the animated "Syncing …"
  // text once a sync finishes without anything to review (e.g. "Nothing new
  // from Plaid"). Null while idle / busy / when we navigate to review.
  const [finalMessage, setFinalMessage] = useState<string | null>(null);

  const onClick = useCallback(async () => {
    if (items.length === 0) return;
    setBusy(true);
    setResults(null);
    setFinalMessage(null);
    const collected: PerItemResult[] = [];

    // Kick off a balance refresh in parallel — the dashboard's Net Worth view
    // uses the same `balances-sync` endpoint as the manual "Refresh balances"
    // button. Fire-and-forget: we don't block on it and don't surface errors.
    // By the time the user returns to /dashboard, latest snapshots will be in.
    const balanceRefresh = fetch("/api/plaid/balances-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).catch(() => {
      /* silent — sync is the user-visible action; balances are bonus */
    });

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const label = item.institutionName ?? item.itemId.slice(0, 8);
      setProgress(`Syncing ${label} (${i + 1}/${items.length})…`);

      if (item.stagedCount > 0 || item.removalCount > 0) {
        collected.push({
          itemId: item.itemId,
          institutionName: item.institutionName,
          status: { kind: "already-pending" },
        });
        continue;
      }

      const from = item.lastSyncedAt ? item.lastSyncedAt.slice(0, 10) : undefined;
      try {
        const resp = await fetch("/api/plaid/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemId: item.itemId, from }),
        });
        const data = (await resp.json()) as {
          ok: boolean;
          stagedCount?: number;
          removalCount?: number;
          error?: string;
        };
        if (!data.ok) {
          collected.push({
            itemId: item.itemId,
            institutionName: item.institutionName,
            status: { kind: "error", message: data.error ?? "unknown" },
          });
        } else if ((data.stagedCount ?? 0) === 0 && (data.removalCount ?? 0) === 0) {
          collected.push({
            itemId: item.itemId,
            institutionName: item.institutionName,
            status: { kind: "empty" },
          });
        } else {
          collected.push({
            itemId: item.itemId,
            institutionName: item.institutionName,
            status: {
              kind: "staged",
              stagedCount: data.stagedCount ?? 0,
              removalCount: data.removalCount ?? 0,
            },
          });
        }
      } catch (err) {
        collected.push({
          itemId: item.itemId,
          institutionName: item.institutionName,
          status: {
            kind: "error",
            message: err instanceof Error ? err.message : "sync failed",
          },
        });
      }
    }

    // Make sure the balance refresh has landed before we navigate away, so
    // the next dashboard render shows fresh numbers. Errors here are ignored.
    await balanceRefresh;

    setProgress(null);
    setBusy(false);

    // Only navigate to the review page when there's actually something to
    // review — a fresh staged batch or one already pending from a prior sync.
    const needsReview = collected.some(
      (r) => r.status.kind === "staged" || r.status.kind === "already-pending",
    );
    if (needsReview) {
      const ids = collected.map((r) => r.itemId).join(",");
      router.push(
        `/settings/plaid/review-all?items=${encodeURIComponent(ids)}&from=dashboard`,
      );
      return;
    }

    // Nothing to review: stay on the dashboard. Surface the outcome in the same
    // inline spot the "Syncing …" text animated, so the layout doesn't jump.
    // Only keep the per-bank breakdown around when a bank errored (that's
    // actionable); the all-clear case is just the one-line message.
    const errored = collected.filter((r) => r.status.kind === "error");
    if (errored.length > 0) {
      setResults(collected);
      setFinalMessage(
        `Nothing new from Plaid · ${errored.length} bank${errored.length === 1 ? "" : "s"} errored`,
      );
    } else {
      setFinalMessage("Nothing new from Plaid");
    }
  }, [items, router]);

  if (items.length === 0) {
    return (
      <div style={{ color: "#666", fontSize: "0.9rem" }}>
        No banks linked.{" "}
        <a href="/settings/plaid" style={{ color: "#2563eb" }}>
          Connect a bank
        </a>{" "}
        to enable sync.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
        <button
          type="button"
          onClick={onClick}
          disabled={busy}
          style={{
            padding: "0.55rem 1.1rem",
            borderRadius: 8,
            border: "1px solid #2563eb",
            background: busy ? "#93c5fd" : "#2563eb",
            color: "white",
            fontWeight: 600,
            cursor: busy ? "wait" : "pointer",
          }}
        >
          {busy ? "Syncing…" : `Sync transactions (${items.length} bank${items.length === 1 ? "" : "s"})`}
        </button>
        {(progress ?? finalMessage) && (
          <span
            style={{
              color: finalMessage ? "#15803d" : "#666",
              fontSize: "0.9rem",
              fontWeight: finalMessage ? 600 : 400,
            }}
          >
            {progress ?? finalMessage}
          </span>
        )}
      </div>
      {results && (
        <ul style={{ margin: 0, padding: "0.25rem 0 0 1rem", fontSize: "0.9rem", color: "#444" }}>
          {results.map((r) => {
            const label = r.institutionName ?? r.itemId.slice(0, 8);
            let line: string;
            switch (r.status.kind) {
              case "staged":
                line = `${label}: ${r.status.stagedCount} new, ${r.status.removalCount} removals — needs review`;
                break;
              case "empty":
                line = `${label}: nothing new`;
                break;
              case "already-pending":
                line = `${label}: batch already pending review`;
                break;
              case "error":
                line = `${label}: error — ${r.status.message}`;
                break;
            }
            return <li key={r.itemId}>{line}</li>;
          })}
        </ul>
      )}
    </div>
  );
}
