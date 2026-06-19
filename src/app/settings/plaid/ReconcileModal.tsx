"use client";

import { useMemo, useState } from "react";
import type { LocalAccountOption } from "./BanksClient.tsx";

export interface PlaidAccountSummary {
  account_id: string;
  name: string;
  official_name: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
}

interface ReconcileModalProps {
  itemId: string;
  institutionName: string | null;
  plaidAccounts: PlaidAccountSummary[];
  localAccounts: LocalAccountOption[];
  onClose: () => void;
  onComplete: () => void;
}

type Decision = { action: "create" } | { action: "merge"; existingAccountId: string };

export function ReconcileModal({
  itemId,
  institutionName,
  plaidAccounts,
  localAccounts,
  onClose,
  onComplete,
}: ReconcileModalProps) {
  const initial = useMemo(() => {
    // Pre-fill: if a local account with the same institution + same last4 (mask)
    // exists, default to "merge" with it; else "create".
    const map = new Map<string, Decision>();
    for (const p of plaidAccounts) {
      const candidate = localAccounts.find(
        (a) =>
          (institutionName
            ? a.institutionName.toLowerCase() === institutionName.toLowerCase()
            : false) && p.mask && a.accountNumberLast4 === p.mask,
      );
      map.set(p.account_id, candidate
        ? { action: "merge", existingAccountId: candidate.id }
        : { action: "create" });
    }
    return map;
  }, [plaidAccounts, localAccounts, institutionName]);

  const [decisions, setDecisions] = useState<Map<string, Decision>>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelectChange = (plaidAccountId: string, value: string) => {
    if (value === "__create__") {
      setDecisions((m) => new Map(m).set(plaidAccountId, { action: "create" }));
    } else {
      setDecisions((m) =>
        new Map(m).set(plaidAccountId, { action: "merge", existingAccountId: value }),
      );
    }
  };

  const onSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const mappings = plaidAccounts.map((p) => {
        const d = decisions.get(p.account_id) ?? { action: "create" as const };
        if (d.action === "merge") {
          return {
            plaidAccountId: p.account_id,
            action: "merge" as const,
            existingAccountId: d.existingAccountId,
          };
        }
        return { plaidAccountId: p.account_id, action: "create" as const };
      });
      const resp = await fetch("/api/plaid/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, mappings }),
      });
      const data = (await resp.json()) as { ok: boolean; error?: string };
      if (!data.ok) {
        setError(data.error ?? "Reconcile failed");
        return;
      }
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reconcile failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 10,
          padding: "1.5rem",
          width: "min(720px, 92vw)",
          maxHeight: "90vh",
          overflowY: "auto",
          boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: "1.25rem" }}>
            Reconcile {institutionName ?? "bank"} accounts
          </h2>
          <p style={{ margin: "0.5rem 0 0", opacity: 0.7, fontSize: 14 }}>
            For each account, choose whether to create a new local account or merge
            into an existing one (e.g. one you already have CSV history for).
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {plaidAccounts.map((p) => {
            const d = decisions.get(p.account_id) ?? { action: "create" };
            const value = d.action === "merge" ? d.existingAccountId : "__create__";
            return (
              <div
                key={p.account_id}
                style={{
                  border: "1px solid rgba(0,0,0,0.1)",
                  borderRadius: 8,
                  padding: "0.75rem 1rem",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {p.name}
                    {p.mask ? ` ··${p.mask}` : ""}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.65 }}>
                    {p.type}
                    {p.subtype ? ` / ${p.subtype}` : ""}
                  </div>
                </div>
                <select
                  value={value}
                  onChange={(e) => handleSelectChange(p.account_id, e.target.value)}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 6,
                    border: "1px solid rgba(0,0,0,0.15)",
                    minWidth: 260,
                    fontSize: 14,
                  }}
                >
                  <option value="__create__">Create new local account</option>
                  {localAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      Merge → {a.label}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>

        {error && <div style={{ color: "#dc2626", fontSize: 14 }}>{error}</div>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: "1px solid rgba(0,0,0,0.15)",
              background: "#fff",
              cursor: submitting ? "not-allowed" : "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={submitting}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: "none",
              background: submitting ? "#9ca3af" : "#1a1f3a",
              color: "#fff",
              cursor: submitting ? "not-allowed" : "pointer",
              fontWeight: 600,
            }}
          >
            {submitting ? "Saving…" : "Save reconciliation"}
          </button>
        </div>
      </div>
    </div>
  );
}
