"use client";

import type { TagTotal } from "../../lib/types.ts";
import { formatMoney } from "../../lib/format.ts";

const COLORS = [
  "#6366f1", "#f59e0b", "#ef4444", "#10b981",
  "#3b82f6", "#f97316", "#8b5cf6", "#06b6d4",
  "#84cc16", "#ec4899", "#64748b", "#a16207",
];

export default function TagBreakdown({ data }: { data: TagTotal[] }) {
  if (data.length === 0) {
    return (
      <div style={{ padding: "2.5rem", textAlign: "center", color: "#bbb", fontSize: "1.025rem" }}>
        No tagged spending this month.
      </div>
    );
  }

  const max = Math.max(...data.map((d) => d.total), 1);

  return (
    <div style={{ padding: "1.25rem" }}>
      <p style={{ fontSize: "0.845rem", color: "#aaa", margin: "0 0 1rem", lineHeight: 1.4 }}>
        Totals can overlap — a transaction tagged in two groups counts toward both.
      </p>

      {data.map((row, i) => (
        <div key={row.tag} style={{ marginBottom: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.3rem" }}>
            <span style={{ fontSize: "1.025rem", fontWeight: 500 }}>
              {row.tag === "untagged" ? <em style={{ color: "#aaa" }}>untagged</em> : row.tag}
            </span>
            <span data-sensitive style={{ fontSize: "0.975rem", fontWeight: 600, color: "#333" }}>
              {formatMoney(row.total)}
              <span style={{ fontWeight: 400, color: "#aaa", fontSize: "0.875rem", marginLeft: 4 }}>
                ({row.count} txn{row.count !== 1 ? "s" : ""})
              </span>
            </span>
          </div>
          <div style={{ height: 6, background: "#f0f0f0", borderRadius: 3, overflow: "hidden" }}>
            <div style={{
              height: "100%",
              width: `${(row.total / max) * 100}%`,
              background: row.tag === "untagged" ? "#d1d5db" : COLORS[i % COLORS.length],
              borderRadius: 3,
              transition: "width 0.3s ease",
            }} />
          </div>
        </div>
      ))}
    </div>
  );
}
