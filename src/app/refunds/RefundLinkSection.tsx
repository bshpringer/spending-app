"use client";

import { useEffect, useState, useTransition } from "react";
import { formatMoney } from "../../lib/format.ts";
import {
  getRefundLinkInfo,
  linkRefundManual,
  unlinkRefundMatch,
  type LinkedCounterpart,
  type LinkCandidate,
} from "../../lib/actions.ts";

export default function RefundLinkSection(props: { transactionId: string }) {
  const [linked, setLinked] = useState<LinkedCounterpart[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<LinkCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function refresh(q: string) {
    setLoading(true);
    try {
      const info = await getRefundLinkInfo(props.transactionId, q);
      setLinked(info.linked);
      setCandidates(info.candidates);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh("");
  }, [props.transactionId]);

  // Debounce search input
  useEffect(() => {
    if (!showPicker) return;
    const handle = setTimeout(() => refresh(query), 200);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, showPicker]);

  function handleLink(candidateId: string) {
    setError(null);
    startTransition(async () => {
      const result = await linkRefundManual(props.transactionId, candidateId);
      if (!result.ok) {
        setError(result.error ?? "Could not link.");
        return;
      }
      setShowPicker(false);
      setQuery("");
      await refresh("");
    });
  }

  function handleUnlink(counterpart: LinkedCounterpart) {
    // Server expects (expenseId, refundId) — derive from signs.
    startTransition(async () => {
      // We know one side is props.transactionId; figure out which is expense.
      // Counterpart amount sign tells us the rest.
      const counterpartIsExpense = counterpart.amount < 0;
      const expenseId = counterpartIsExpense ? counterpart.id : props.transactionId;
      const refundId = counterpartIsExpense ? props.transactionId : counterpart.id;
      await unlinkRefundMatch(expenseId, refundId);
      await refresh("");
    });
  }

  return (
    <div style={{ marginBottom: "0.9rem" }}>
      <label style={{ display: "block", fontSize: "0.905rem", fontWeight: 600, marginBottom: "0.3rem", opacity: 0.7 }}>
        Linked refund/charge
      </label>
      {loading && linked.length === 0 && (
        <div style={{ fontSize: "0.85rem", opacity: 0.5 }}>Loading…</div>
      )}
      {linked.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", marginBottom: "0.5rem" }}>
          {linked.map((l) => (
            <div
              key={l.id}
              style={{
                display: "flex",
                gap: "0.5rem",
                alignItems: "center",
                fontSize: "0.875rem",
                padding: "0.35rem 0.5rem",
                background: "#f9fafb",
                border: "1px solid #e5e7eb",
                borderRadius: 4,
              }}
            >
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <span data-sensitive>{l.name}</span>
                <span style={{ opacity: 0.55, marginLeft: 6 }}>· {l.date}</span>
              </span>
              <span data-sensitive style={{ color: l.amount < 0 ? "#a00" : "#070", fontVariantNumeric: "tabular-nums" }}>
                {formatMoney(l.amount)}
              </span>
              <button
                type="button"
                disabled={isPending}
                onClick={() => handleUnlink(l)}
                style={smallBtn}
              >
                Unlink
              </button>
            </div>
          ))}
        </div>
      )}

      {!showPicker ? (
        <button
          type="button"
          onClick={() => setShowPicker(true)}
          style={{ ...smallBtn, padding: "0.3rem 0.7rem" }}
        >
          {linked.length > 0 ? "Link another…" : "Link to…"}
        </button>
      ) : (
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 4, padding: "0.6rem", marginTop: "0.25rem" }}>
          <div style={{ display: "flex", gap: "0.4rem", marginBottom: "0.5rem" }}>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by merchant or amount…"
              autoFocus
              style={{
                flex: 1,
                padding: "0.3rem 0.5rem",
                border: "1px solid #ccc",
                borderRadius: 4,
                fontSize: "0.875rem",
              }}
            />
            <button
              type="button"
              onClick={() => { setShowPicker(false); setQuery(""); setError(null); }}
              style={smallBtn}
            >
              Cancel
            </button>
          </div>
          {error && (
            <div style={{ color: "#a00", fontSize: "0.8rem", marginBottom: "0.4rem" }}>{error}</div>
          )}
          <div style={{ maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            {candidates.length === 0 && !loading && (
              <div style={{ fontSize: "0.85rem", opacity: 0.55, padding: "0.4rem" }}>
                No opposite-sign transactions within 180 days.
              </div>
            )}
            {candidates.map((c) => (
              <button
                key={c.id}
                type="button"
                disabled={isPending}
                onClick={() => handleLink(c.id)}
                style={{
                  textAlign: "left",
                  background: c.sameAmount ? "#f0fdf4" : "#fff",
                  border: "1px solid",
                  borderColor: c.sameAmount ? "#bbf7d0" : "#e5e7eb",
                  borderRadius: 4,
                  padding: "0.35rem 0.5rem",
                  cursor: isPending ? "default" : "pointer",
                  fontSize: "0.85rem",
                  display: "flex",
                  gap: "0.5rem",
                  alignItems: "center",
                }}
              >
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <span data-sensitive>{c.name}</span>
                  <span style={{ opacity: 0.55, marginLeft: 6 }}>· {c.date}</span>
                  {c.sameAmount && (
                    <span style={{ marginLeft: 6, fontSize: "0.72rem", color: "#166534", fontWeight: 600 }}>
                      = same amount
                    </span>
                  )}
                </span>
                <span data-sensitive style={{ color: c.amount < 0 ? "#a00" : "#070", fontVariantNumeric: "tabular-nums" }}>
                  {formatMoney(c.amount)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const smallBtn: React.CSSProperties = {
  padding: "0.25rem 0.6rem",
  fontSize: "0.8rem",
  background: "#fff",
  border: "1px solid #ccc",
  borderRadius: 4,
  cursor: "pointer",
};
