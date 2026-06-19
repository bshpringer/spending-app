"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { Profile } from "@/lib/types.ts";
import {
  ReviewClient,
  type MatchedTxnView,
  type RemovalRowView,
  type StagedRowView,
} from "../review/[itemId]/ReviewClient.tsx";

export interface BankTabData {
  itemId: string;
  institutionName: string | null;
  rows: StagedRowView[];
  removalRows: RemovalRowView[];
  matchedById: Record<string, MatchedTxnView>;
}

interface Props {
  tabs: BankTabData[];
  categories: string[];
  profiles: Profile[];
  canonicalSuggestions: string[];
  customSuggestions: string[];
  customByCanonical: Record<string, string[]>;
}

type TabState = "pending" | "committed" | "discarded";

export function ReviewAllClient({ tabs, categories, profiles, canonicalSuggestions, customSuggestions, customByCanonical }: Props) {
  const router = useRouter();
  const [activeIdx, setActiveIdx] = useState(() => {
    // Default to the first tab that has any rows; otherwise the first tab.
    const firstWithItems = tabs.findIndex(
      (t) => t.rows.length > 0 || t.removalRows.length > 0,
    );
    return firstWithItems >= 0 ? firstWithItems : 0;
  });
  const [states, setStates] = useState<TabState[]>(() => tabs.map(() => "pending"));

  const advance = useCallback(
    (fromIdx: number, nextState: TabState) => {
      setStates((prev) => {
        const copy = [...prev];
        copy[fromIdx] = nextState;
        return copy;
      });
      // Auto-advance to the next pending tab that still has content to review.
      const nextIdx = tabs.findIndex(
        (t, i) =>
          i > fromIdx &&
          states[i] === "pending" &&
          (t.rows.length > 0 || t.removalRows.length > 0),
      );
      if (nextIdx >= 0) {
        setActiveIdx(nextIdx);
      } else {
        // No more tabs to review. Refresh so /settings/plaid banner state is current.
        router.refresh();
      }
    },
    [tabs, states, router],
  );

  const active = tabs[activeIdx];
  const activeState = states[activeIdx];
  const activeIsLocked = activeState !== "pending";
  const activeHasItems = active.rows.length > 0 || active.removalRows.length > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Tab strip */}
      <div
        style={{
          display: "flex",
          gap: 4,
          borderBottom: "1px solid #e5e7eb",
          overflowX: "auto",
          overflowY: "hidden",
        }}
      >
        {tabs.map((t, i) => {
          const isActive = i === activeIdx;
          const state = states[i];
          const count = t.rows.length;
          const removalCount = t.removalRows.length;
          const isEmpty = count === 0 && removalCount === 0;
          return (
            <button
              key={t.itemId}
              type="button"
              onClick={() => setActiveIdx(i)}
              style={{
                padding: "0.55rem 0.95rem",
                background: isActive ? "white" : "transparent",
                border: "1px solid",
                borderColor: isActive ? "#e5e7eb" : "transparent",
                borderBottom: isActive ? "1px solid white" : "none",
                marginBottom: -1,
                borderTopLeftRadius: 8,
                borderTopRightRadius: 8,
                cursor: "pointer",
                color: isActive ? "#111" : "#555",
                fontWeight: isActive ? 600 : 400,
                fontSize: "0.925rem",
                whiteSpace: "nowrap",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span>{t.institutionName ?? t.itemId.slice(0, 8)}</span>
              <span
                style={{
                  fontSize: "0.8rem",
                  padding: "0.05rem 0.4rem",
                  borderRadius: 999,
                  background: isEmpty ? "#f3f4f6" : "#e0e7ff",
                  color: isEmpty ? "#888" : "#3730a3",
                  fontWeight: 600,
                }}
              >
                {count}
                {removalCount > 0 ? ` · -${removalCount}` : ""}
              </span>
              {state === "committed" && (
                <span style={{ color: "#16a34a", fontSize: "0.85rem" }} title="Committed">
                  ✓
                </span>
              )}
              {state === "discarded" && (
                <span style={{ color: "#9ca3af", fontSize: "0.85rem" }} title="Discarded">
                  ✕
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab body */}
      <div>
        <div style={{ fontSize: 14, opacity: 0.7, marginBottom: "0.75rem" }}>
          {active.institutionName ?? "(unknown institution)"} · {active.rows.length} pulled
          {active.removalRows.length > 0 ? ` · ${active.removalRows.length} removed by Plaid` : ""}
          {activeState === "committed" && " · committed"}
          {activeState === "discarded" && " · discarded"}
        </div>

        {!activeHasItems ? (
          <div
            style={{
              padding: "2rem",
              textAlign: "center",
              color: "#888",
              background: "#fafafa",
              borderRadius: 8,
            }}
          >
            Nothing new from this bank.
          </div>
        ) : activeIsLocked ? (
          <div
            style={{
              padding: "1.5rem",
              color: "#666",
              background: "#fafafa",
              borderRadius: 8,
            }}
          >
            This batch has been {activeState}. Pick another tab to continue reviewing.
          </div>
        ) : (
          <ReviewClient
            key={active.itemId}
            itemId={active.itemId}
            rows={active.rows}
            removalRows={active.removalRows}
            matchedById={active.matchedById}
            categories={categories}
            profiles={profiles}
            canonicalSuggestions={canonicalSuggestions}
            customSuggestions={customSuggestions}
            customByCanonical={customByCanonical}
            onAfterCommit={() => advance(activeIdx, "committed")}
            onAfterDiscard={() => advance(activeIdx, "discarded")}
          />
        )}
      </div>
    </div>
  );
}
