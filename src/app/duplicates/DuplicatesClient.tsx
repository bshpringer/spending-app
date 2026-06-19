"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatMoney } from "../../lib/format.ts";
import {
  markDuplicateKept,
  restoreDuplicateReview,
  deleteTransaction,
} from "../../lib/actions.ts";
import type { Transaction } from "../../lib/types.ts";
import { TransactionEditModal } from "../transactions/TransactionEditModal.tsx";

interface ModalCtx {
  availableTags: { id: string; displayName: string }[];
  availableCategories: string[];
  accountLabels: Record<string, string>;
}

export interface DuplicateSuggestionRow {
  a: Transaction;
  b: Transaction;
  aAccountLabel: string;
  bAccountLabel: string;
  confidence: "high" | "low";
  reason: string;
  daysApart: number;
}

export interface DuplicateReviewedRow {
  a: Transaction;
  b: Transaction;
  aAccountLabel: string;
  bAccountLabel: string;
  createdAt: string;
}

type Tab = "suggested" | "reviewed";

interface Props {
  suggestions: DuplicateSuggestionRow[];
  reviewed: DuplicateReviewedRow[];
  profileParam: string | undefined;
  initialTab: Tab;
  availableTags: { id: string; displayName: string }[];
  availableCategories: string[];
  accountLabels: Record<string, string>;
}

export default function DuplicatesClient(props: Props) {
  const modalCtx: ModalCtx = {
    availableTags: props.availableTags,
    availableCategories: props.availableCategories,
    accountLabels: props.accountLabels,
  };
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [tab, setTab] = useState<Tab>(props.initialTab);
  const profileSuffix = props.profileParam ? `?profile=${encodeURIComponent(props.profileParam)}` : "";

  function handleKeepBoth(aId: string, bId: string) {
    startTransition(async () => {
      await markDuplicateKept(aId, bId);
      router.refresh();
    });
  }
  function handleDelete(id: string) {
    if (!window.confirm("Delete this transaction permanently? This cannot be undone.")) return;
    startTransition(async () => {
      await deleteTransaction(id);
      router.refresh();
    });
  }
  function handleRestore(aId: string, bId: string) {
    startTransition(async () => {
      await restoreDuplicateReview(aId, bId);
      router.refresh();
    });
  }

  return (
    <main style={{ padding: "1.5rem 2rem", maxWidth: 1100, margin: "0 auto", width: "100%" }}>
      <h1 style={{ fontSize: "1.75rem", fontWeight: 700, margin: "0 0 0.25rem" }}>Duplicates</h1>
      <div style={{ fontSize: "0.95rem", opacity: 0.75, marginBottom: "1.25rem" }}>
        Review transaction pairs that look like accidental duplicates — same account, exact amount, within a few days.
        Pick <strong>Keep both</strong> if they&apos;re distinct charges, or delete one if it&apos;s a real duplicate.{" "}
        <Link href={`/transactions${profileSuffix}`} style={{ color: "#2563eb", textDecoration: "none" }}>
          ← Back to transactions
        </Link>
      </div>

      <div style={{ display: "inline-flex", gap: 4, marginBottom: "1rem" }}>
        <button onClick={() => setTab("suggested")} style={pillStyle(tab === "suggested")}>
          Suggested ({props.suggestions.length})
        </button>
        <button onClick={() => setTab("reviewed")} style={pillStyle(tab === "reviewed")}>
          Reviewed ({props.reviewed.length})
        </button>
      </div>

      {tab === "suggested" && (
        <SuggestedSection
          rows={props.suggestions}
          isPending={isPending}
          onKeepBoth={handleKeepBoth}
          onDelete={handleDelete}
          profileSuffix={profileSuffix}
          modalCtx={modalCtx}
        />
      )}
      {tab === "reviewed" && (
        <ReviewedSection
          rows={props.reviewed}
          isPending={isPending}
          onRestore={handleRestore}
          profileSuffix={profileSuffix}
          modalCtx={modalCtx}
        />
      )}
    </main>
  );
}

function SuggestedSection(props: {
  rows: DuplicateSuggestionRow[];
  isPending: boolean;
  onKeepBoth: (aId: string, bId: string) => void;
  onDelete: (id: string) => void;
  profileSuffix: string;
  modalCtx: ModalCtx;
}) {
  if (props.rows.length === 0) {
    return <p style={{ opacity: 0.6 }}>No duplicate suggestions. We&apos;ll surface them as new transactions land.</p>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {props.rows.map((r) => (
        <div key={`${r.a.id}-${r.b.id}`} style={cardStyle}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.05em", opacity: 0.6 }}>
              Possible duplicate pair
            </div>
            <ConfidenceBadge confidence={r.confidence} />
          </div>
          <PairRow tx={r.a} accountLabel={r.aAccountLabel} modalCtx={props.modalCtx} />
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed #eee" }}>
            <PairRow tx={r.b} accountLabel={r.bAccountLabel} modalCtx={props.modalCtx} />
            <div style={{ fontSize: "0.78rem", opacity: 0.6, margin: "6px 0 8px" }}>{r.reason}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button
                disabled={props.isPending}
                onClick={() => props.onKeepBoth(r.a.id, r.b.id)}
                style={primaryBtn}
                title="Both rows are real and distinct — stop suggesting this pair"
              >
                Keep both
              </button>
              <button
                disabled={props.isPending}
                onClick={() => props.onDelete(r.a.id)}
                style={dangerBtn}
                title={`Delete the ${r.a.originalDate || r.a.date} charge permanently`}
              >
                Delete {r.a.originalDate || r.a.date}
              </button>
              <button
                disabled={props.isPending}
                onClick={() => props.onDelete(r.b.id)}
                style={dangerBtn}
                title={`Delete the ${r.b.originalDate || r.b.date} charge permanently`}
              >
                Delete {r.b.originalDate || r.b.date}
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ReviewedSection(props: {
  rows: DuplicateReviewedRow[];
  isPending: boolean;
  onRestore: (aId: string, bId: string) => void;
  profileSuffix: string;
  modalCtx: ModalCtx;
}) {
  if (props.rows.length === 0) {
    return <p style={{ opacity: 0.6 }}>No reviewed pairs yet. Pairs you mark &ldquo;Keep both&rdquo; land here.</p>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {props.rows.map((p) => (
        <div key={`${p.a.id}-${p.b.id}`} style={{ ...cardStyle, opacity: 0.75 }}>
          <PairRow tx={p.a} accountLabel={p.aAccountLabel} modalCtx={props.modalCtx} />
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed #eee" }}>
            <PairRow tx={p.b} accountLabel={p.bAccountLabel} modalCtx={props.modalCtx} />
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <button
                disabled={props.isPending}
                onClick={() => props.onRestore(p.a.id, p.b.id)}
                style={smallBtn}
                title="Removes the review — the pair becomes eligible to be suggested again"
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

function PairRow(props: { tx: Transaction; accountLabel: string; modalCtx: ModalCtx }) {
  const tx = props.tx;
  const merchant = tx.customName ?? tx.canonicalName ?? tx.name;
  const isExpense = tx.amount < 0;

  // Paper-trail extras — always show raw + source so two same-amount charges
  // can be compared apples-to-apples even when the displayed merchant matches.
  const desc = (tx.description ?? "").trim();
  const note = (tx.note ?? "").trim();
  const showCanonical = !!tx.canonicalName && tx.canonicalName !== tx.name;
  const showDesc = desc.length > 0 && desc !== tx.name;
  const postedDate = tx.originalDate && tx.originalDate !== tx.date ? tx.date : null;
  const txIdShort = tx.id.slice(0, 8);

  const merchantTrigger = (
    <span
      data-sensitive
      style={{
        color: "#2563eb",
        fontWeight: 500,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        cursor: "pointer",
      }}
      title={`${merchant} — click to edit`}
      onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
      onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}
    >
      {merchant}
    </span>
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "90px 1fr auto", gap: "0.5rem", alignItems: "start" }}>
      <span style={{ fontSize: "0.78rem", opacity: 0.6, fontVariantNumeric: "tabular-nums", paddingTop: 2 }}>
        {tx.originalDate || tx.date}
      </span>
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0, gap: 2 }}>
        <TransactionEditModal
          transaction={{
            id: tx.id,
            name: tx.name,
            date: tx.date,
            originalDate: tx.originalDate,
            amount: tx.amount,
            customName: tx.customName,
            canonicalName: tx.canonicalName,
            category: tx.category,
            note: tx.note,
            tags: tx.tags,
            excluded: tx.userOverrides?.excluded ?? false,
            oneTime: tx.userOverrides?.oneTime ?? false,
            profileId: tx.profileId,
            accountLabel: tx.accountId ? props.modalCtx.accountLabels[tx.accountId] : undefined,
          }}
          availableTags={props.modalCtx.availableTags}
          availableCategories={props.modalCtx.availableCategories}
          trigger={merchantTrigger}
        />
        <span style={{ fontSize: "0.78rem", opacity: 0.6 }}>
          {props.accountLabel || "—"}
          {tx.category && <> · {tx.category}</>}
          {" · "}
          <span style={{ opacity: 0.7 }}>{tx.source || "csv"}</span>
          {postedDate && <> · <span style={{ opacity: 0.7 }}>posted {postedDate}</span></>}
          {" · "}
          <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", opacity: 0.5 }} title={tx.id}>
            #{txIdShort}
          </span>
        </span>
        <div
          data-sensitive
          style={{
            marginTop: 4,
            padding: "5px 8px",
            background: "#f8fafc",
            borderLeft: "2px solid #e5e7eb",
            borderRadius: 3,
            fontSize: "0.76rem",
            color: "#475569",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            lineHeight: 1.45,
            wordBreak: "break-word",
          }}
        >
          <div><span style={{ opacity: 0.6 }}>raw:</span> {tx.name || <em style={{ opacity: 0.5 }}>(empty)</em>}</div>
          {showCanonical && (
            <div><span style={{ opacity: 0.6 }}>canonical:</span> {tx.canonicalName}</div>
          )}
          {showDesc && (
            <div><span style={{ opacity: 0.6 }}>desc:</span> {desc}</div>
          )}
          {note && (
            <div><span style={{ opacity: 0.6 }}>note:</span> {note}</div>
          )}
          {tx.plaidRaw && (
            <div style={{ marginTop: 4, paddingTop: 4, borderTop: "1px dashed #cbd5e1" }}>
              {tx.plaidRaw.pendingTransactionId && (
                <div><span style={{ opacity: 0.6 }}>pending_id:</span> {tx.plaidRaw.pendingTransactionId}</div>
              )}
              {tx.plaidRaw.referenceNumber && (
                <div><span style={{ opacity: 0.6 }}>reference:</span> {tx.plaidRaw.referenceNumber}</div>
              )}
              {tx.plaidRaw.merchantEntityId && (
                <div><span style={{ opacity: 0.6 }}>merchant_entity:</span> {tx.plaidRaw.merchantEntityId}</div>
              )}
              {tx.plaidRaw.authorizedDatetime && (
                <div><span style={{ opacity: 0.6 }}>authorized:</span> {tx.plaidRaw.authorizedDatetime}</div>
              )}
              {tx.plaidRaw.paymentChannel && (
                <div><span style={{ opacity: 0.6 }}>channel:</span> {tx.plaidRaw.paymentChannel}</div>
              )}
            </div>
          )}
        </div>
      </div>
      <span
        data-sensitive
        style={{ color: isExpense ? "#a00" : "#070", fontVariantNumeric: "tabular-nums", fontWeight: 500, paddingTop: 2 }}
      >
        {formatMoney(tx.amount)}
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
        background: high ? "#fee2e2" : "#fef3c7",
        color: high ? "#991b1b" : "#92400e",
        fontWeight: 600,
        letterSpacing: "0.02em",
      }}
      title={high ? "Same merchant string — very likely a true duplicate" : "Different merchant strings — could be coincidence"}
    >
      {high ? "Likely duplicate" : "Possible — different merchant"}
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
