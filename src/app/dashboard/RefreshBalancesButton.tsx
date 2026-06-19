"use client";

import { useState } from "react";

interface Props {
  lastUpdated: string | null;
}

function formatAsOf(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 2) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

export function RefreshBalancesButton({ lastUpdated }: Props) {
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/plaid/balances-sync", {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!data.ok) setError(data.error ?? "Refresh failed");
      else window.location.reload();
    } catch {
      setError("Network error");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        flexWrap: "wrap",
      }}
    >
      <button
        type="button"
        onClick={handleRefresh}
        disabled={refreshing}
        style={{
          padding: "0.55rem 1.1rem",
          borderRadius: 8,
          border: "1px solid #2563eb",
          background: refreshing ? "#93c5fd" : "#2563eb",
          color: "white",
          fontWeight: 600,
          fontFamily: "inherit",
          cursor: refreshing ? "wait" : "pointer",
        }}
      >
        {refreshing ? "Refreshing balances…" : "Refresh balances"}
      </button>
      {lastUpdated && (
        <span style={{ fontSize: "0.85rem", opacity: 0.55 }}>
          Updated {formatAsOf(lastUpdated)}
        </span>
      )}
      {error && (
        <span style={{ fontSize: "0.85rem", color: "#dc2626" }}>{error}</span>
      )}
    </div>
  );
}
