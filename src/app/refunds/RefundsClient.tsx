"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatMoney } from "../../lib/format.ts";
import {
  confirmRefundMatch,
  rejectRefundMatch,
  unlinkRefundMatch,
} from "../../lib/actions.ts";
import type { Transaction } from "../../lib/types.ts";

export interface ListedPair {
  expense: Transaction;
  refund: Transaction;
  createdAt: string;
}

interface SuggestionRow {
  expense: Transaction;
  refund: Transaction;
  confidence: "high" | "low";
  reason: string;
  expenseAccountLabel: string;
  refundAccountLabel: string;
}

interface ConfirmedRow extends ListedPair {
  expenseAccountLabel: string;
  refundAccountLabel: string;
}

type RejectedRow = ConfirmedRow;
type Tab = "suggested" | "confirmed" | "rejected";

export default function RefundsClient(props: {
  suggestions: SuggestionRow[];
  confirmed: ConfirmedRow[];
  rejected: RejectedRow[];
  profileParam: string | undefined;
  initialTab: Tab;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [tab, setTab] = useState<Tab>(props.initialTab);
  const profileSuffix = props.profileParam ? `?profile=${encodeURIComponent(props.profileParam)}` : "";

  // Group suggestions by refund.id so multi-candidate refunds show as one
  // "which one?" card (still one suggestion per row, but visually clustered).
  const suggestionGroups = useMemo(() => {
    const byRefund = new Map<string, SuggestionRow[]>();
    for (const s of props.suggestions) {
      const arr = byRefund.get(s.refund.id) ?? [];
      arr.push(s);
      byRefund.set(s.refund.id, arr);
    }
    return [...byRefund.values()];
  }, [props.suggestions]);

  function handleConfirm(expenseId: string, refundId: string) {
    startTransition(async () => {
      await confirmRefundMatch(expenseId, refundId);
      router.refresh();
    });
  }
  function handleReject(expenseId: string, refundId: string) {
    startTransition(async () => {
      await rejectRefundMatch(expenseId, refundId);
      router.refresh();
    });
  }
  function handleUnlink(expenseId: string, refundId: string) {
    startTransition(async () => {
      await unlinkRefundMatch(expenseId, refundId);
      router.refresh();
    });
  }

  return (
    <main style={{ padding: "1.5rem 2rem", maxWidth: 1100, margin: "0 auto", width: "100%" }}>
      <h1 style={{ fontSize: "1.75rem", fontWeight: 700, margin: "0 0 0.25rem" }}>Refunds</h1>
      <div style={{ fontSize: "0.95rem", opacity: 0.75, marginBottom: "1.25rem" }}>
        Link a refund back to the charge it cancels. Linking adds per-transaction provenance — it
        doesn&apos;t change category totals (refunds already net at the category level).{" "}
        <Link href={`/transactions${profileSuffix}`} style={{ color: "#2563eb", textDecoration: "none" }}>
          ← Back to transactions
        </Link>
      </div>

      <div style={{ display: "inline-flex", gap: 4, marginBottom: "1rem" }}>
        <button onClick={() => setTab("suggested")} style={pillStyle(tab === "suggested")}>
          Suggested ({props.suggestions.length})
        </button>
        <button onClick={() => setTab("confirmed")} style={pillStyle(tab === "confirmed")}>
          Confirmed ({props.confirmed.length})
        </button>
        <button onClick={() => setTab("rejected")} style={pillStyle(tab === "rejected")}>
          Rejected ({props.rejected.length})
        </button>
      </div>

      {tab === "suggested" && (
        <SuggestedSection
          groups={suggestionGroups}
          isPending={isPending}
          onConfirm={handleConfirm}
          onReject={handleReject}
          profileSuffix={profileSuffix}
        />
      )}
      {tab === "confirmed" && (
        <ConfirmedSection
          rows={props.confirmed}
          isPending={isPending}
          onUnlink={handleUnlink}
          profileSuffix={profileSuffix}
        />
      )}
      {tab === "rejected" && (
        <RejectedSection
          rows={props.rejected}
          isPending={isPending}
          onRestore={handleUnlink}
          profileSuffix={profileSuffix}
        />
      )}
    </main>
  );
}

function SuggestedSection(props: {
  groups: SuggestionRow[][];
  isPending: boolean;
  onConfirm: (expenseId: string, refundId: string) => void;
  onReject: (expenseId: string, refundId: string) => void;
  profileSuffix: string;
}) {
  if (props.groups.length === 0) {
    return <p style={{ opacity: 0.6 }}>No refund suggestions right now. We&apos;ll surface them as new transactions come in.</p>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {props.groups.map((group, gIdx) => {
        const refund = group[0].refund;
        const isMulti = group.length > 1;
        return (
          <div key={`${refund.id}-${gIdx}`} style={cardStyle}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.05em", opacity: 0.6 }}>
                {isMulti ? `Refund matches ${group.length} possible charges — pick one` : "Suggested pair"}
              </div>
              <ConfidenceBadge confidence={group[0].confidence} />
            </div>
            <PairRow tx={refund} label="Refund" accountLabel={group[0].refundAccountLabel} profileSuffix={props.profileSuffix} />
            {group.map((s) => (
              <div key={s.expense.id} style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed #eee" }}>
                <PairRow tx={s.expense} label="Charge" accountLabel={s.expenseAccountLabel} profileSuffix={props.profileSuffix} />
                <div style={{ fontSize: "0.78rem", opacity: 0.6, margin: "4px 0 8px" }}>{s.reason}</div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    disabled={props.isPending}
                    onClick={() => props.onConfirm(s.expense.id, s.refund.id)}
                    style={primaryBtn}
                  >
                    Confirm
                  </button>
                  <button
                    disabled={props.isPending}
                    onClick={() => props.onReject(s.expense.id, s.refund.id)}
                    style={smallBtn}
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function ConfirmedSection(props: {
  rows: ConfirmedRow[];
  isPending: boolean;
  onUnlink: (expenseId: string, refundId: string) => void;
  profileSuffix: string;
}) {
  if (props.rows.length === 0) {
    return <p style={{ opacity: 0.6 }}>No confirmed refund links yet.</p>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {props.rows.map((p) => (
        <div key={`${p.expense.id}-${p.refund.id}`} style={cardStyle}>
          <PairRow tx={p.refund} label="Refund" accountLabel={p.refundAccountLabel} profileSuffix={props.profileSuffix} />
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed #eee" }}>
            <PairRow tx={p.expense} label="Charge" accountLabel={p.expenseAccountLabel} profileSuffix={props.profileSuffix} />
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <button
                disabled={props.isPending}
                onClick={() => props.onUnlink(p.expense.id, p.refund.id)}
                style={smallBtn}
              >
                Unlink
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function RejectedSection(props: {
  rows: RejectedRow[];
  isPending: boolean;
  onRestore: (expenseId: string, refundId: string) => void;
  profileSuffix: string;
}) {
  if (props.rows.length === 0) {
    return <p style={{ opacity: 0.6 }}>No rejected pairs yet.</p>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {props.rows.map((p) => (
        <div key={`${p.expense.id}-${p.refund.id}`} style={{ ...cardStyle, opacity: 0.7 }}>
          <PairRow tx={p.refund} label="Refund" accountLabel={p.refundAccountLabel} profileSuffix={props.profileSuffix} />
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed #eee" }}>
            <PairRow tx={p.expense} label="Charge" accountLabel={p.expenseAccountLabel} profileSuffix={props.profileSuffix} />
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <button
                disabled={props.isPending}
                onClick={() => props.onRestore(p.expense.id, p.refund.id)}
                style={smallBtn}
                title="Removes the rejection — the pair becomes eligible to be suggested again"
              >
                Restore
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function PairRow(props: { tx: Transaction; label: string; accountLabel: string; profileSuffix: string }) {
  // Use canonicalName-first to match /merchants grouping precedence (links resolve to the right group).
  const merchant = props.tx.canonicalName ?? props.tx.customName ?? props.tx.name;
  const isExpense = props.tx.amount < 0;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "60px 1fr auto", gap: "0.5rem", alignItems: "center" }}>
      <span style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.05em", opacity: 0.55 }}>
        {props.label}
      </span>
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <Link
          href={`/merchants/${encodeURIComponent(merchant)}${props.profileSuffix}`}
          data-sensitive
          style={{ color: "#2563eb", textDecoration: "none", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          title={merchant}
        >
          {merchant}
        </Link>
        <span style={{ fontSize: "0.78rem", opacity: 0.6 }}>
          {props.tx.originalDate || props.tx.date} · {props.accountLabel || "—"}
        </span>
      </div>
      <span
        data-sensitive
        style={{ color: isExpense ? "#a00" : "#070", fontVariantNumeric: "tabular-nums", fontWeight: 500 }}
      >
        {formatMoney(props.tx.amount)}
      </span>
    </div>
  );
}

function ConfidenceBadge(props: { confidence: "high" | "low" }) {
  const high = props.confidence === "high";
  return (
    <span
      style={{
        fontSize: "0.72rem",
        padding: "2px 8px",
        borderRadius: 999,
        background: high ? "#dcfce7" : "#fef3c7",
        color: high ? "#166534" : "#92400e",
        fontWeight: 600,
        letterSpacing: "0.02em",
      }}
    >
      {high ? "High" : "Low — different merchant"}
    </span>
  );
}

const cardStyle: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  padding: "0.85rem 1rem",
  background: "#fff",
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
