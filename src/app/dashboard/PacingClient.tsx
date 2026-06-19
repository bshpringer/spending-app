"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceDot,
} from "recharts";
import { formatMoney } from "@/lib/format.ts";
import type { PacingResult, PacingGranularity } from "@/lib/pacing.ts";
import { PacingDrillDown } from "./PacingDrillDown.tsx";
import type { AccountInfo } from "../transactions/BulkEditTable.tsx";

interface Props {
  pacing: PacingResult;
  /** Currently-active granularity (from URL `?pacingG=`). */
  granularity: PacingGranularity;
  /** Profile filter from the URL, threaded through so the pills preserve it. */
  profileParam?: string;
  /** Profile filter resolved to ids (for drill-down query). */
  profileIds: string[] | null;
  /** Drill-down dependencies. */
  accounts: AccountInfo[];
  availableTags: { id: string; displayName: string }[];
  availableCategories: string[];
  profiles?: { id: string; displayName: string; color?: string }[];
}

function formatDollarShort(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${Math.round(n)}`;
}

const VISIBLE_GRANULARITIES: PacingGranularity[] = ["month", "quarter", "year"];
const GRANULARITY_LABELS: Record<PacingGranularity, string> = {
  month: "Month",
  quarter: "Quarter",
  year: "Year",
};

const HEADLINE_LABELS: Record<PacingGranularity, string> = {
  month: "Current spend this month",
  quarter: "Current spend this quarter",
  year: "Current spend this year",
};

export function PacingClient({
  pacing,
  granularity,
  profileParam,
  profileIds,
  accounts,
  availableTags,
  availableCategories,
  profiles,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [includeOneTime, setIncludeOneTime] = useState(false);
  const [obscured, setObscured] = useState(false);
  const [selectedBucketIndex, setSelectedBucketIndex] = useState<number | null>(null);

  // Reset selection whenever granularity changes — the bucket index meaning shifts.
  useEffect(() => {
    setSelectedBucketIndex(null);
  }, [granularity]);

  useEffect(() => {
    setObscured(document.body.classList.contains("obscure-mode"));
    const observer = new MutationObserver(() => {
      setObscured(document.body.classList.contains("obscure-mode"));
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  function changeGranularity(g: PacingGranularity) {
    if (g === granularity) return;
    const params = new URLSearchParams();
    if (profileParam && profileParam !== "all") params.set("profile", profileParam);
    if (g !== "month") params.set("pacingG", g);
    const qs = params.toString();
    startTransition(() => {
      router.push(`/dashboard${qs ? `?${qs}` : ""}`);
    });
  }

  const currentTotal = includeOneTime
    ? pacing.currentTotalInclOneTime
    : pacing.currentTotalExclOneTime;
  const previousAtSamePoint = includeOneTime
    ? pacing.previousAtSamePointInclOneTime
    : pacing.previousAtSamePointExclOneTime;

  const delta = currentTotal - previousAtSamePoint;
  const deltaAbs = Math.abs(delta);
  const isAbove = delta > 0.005;
  const isBelow = delta < -0.005;

  const chartData = useMemo(
    () =>
      pacing.buckets.map((b) => ({
        index: b.index,
        label: b.label,
        previousLabel: b.previousLabel,
        currentTooltipLabel: b.currentTooltipLabel,
        previousTooltipLabel: b.previousTooltipLabel,
        current: includeOneTime ? b.currentInclOneTime : b.currentExclOneTime,
        previous: includeOneTime ? b.previousInclOneTime : b.previousExclOneTime,
      })),
    [pacing.buckets, includeOneTime],
  );

  const todayPoint = useMemo(() => {
    const row = chartData.find((d) => d.index === pacing.currentBucketIndex);
    if (!row || row.current == null) return null;
    return { index: row.index, value: row.current };
  }, [chartData, pacing.currentBucketIndex]);

  function onChartClick(state: { activeLabel?: string | number } | null) {
    if (!state || state.activeLabel == null) return;
    const idx = typeof state.activeLabel === "number" ? state.activeLabel : parseInt(String(state.activeLabel), 10);
    if (!Number.isFinite(idx)) return;
    setSelectedBucketIndex((prev) => (prev === idx ? null : idx));
  }

  const selectedBucket = selectedBucketIndex != null
    ? pacing.buckets.find((b) => b.index === selectedBucketIndex) ?? null
    : null;

  // Tooltip labels referenced by both the recharts Tooltip and the panel headings.
  const periodSubLabel = (g: PacingGranularity) =>
    g === "year" ? "weekly" : "daily";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <section
        style={{
          background: "#1a1f3a",
          color: "#fff",
          borderRadius: 12,
          padding: "1.75rem 2rem 1.25rem",
          display: "flex",
          flexDirection: "column",
          gap: "0.5rem",
          opacity: pending ? 0.85 : 1,
          transition: "opacity 0.1s",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "1rem",
          }}
        >
          <div>
            <div
              style={{
                fontSize: "0.75rem",
                opacity: 0.6,
                marginBottom: "0.35rem",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                fontWeight: 600,
              }}
            >
              {HEADLINE_LABELS[granularity]}
            </div>
            <div
              data-sensitive
              style={{
                fontSize: "2.5rem",
                fontWeight: 700,
                letterSpacing: "-0.02em",
                fontVariantNumeric: "tabular-nums",
                lineHeight: 1.1,
              }}
            >
              {formatMoney(currentTotal)}
            </div>
          </div>

          {/* Granularity pills — horizontally centered, top-aligned, sized to
              match the "vs last period" delta pill height on the right */}
          <div
            style={{
              display: "inline-flex",
              gap: 3,
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.18)",
              borderRadius: 999,
              padding: 3,
              alignSelf: "flex-start",
              marginTop: "0.25rem",
            }}
          >
            {VISIBLE_GRANULARITIES.map((g) => {
              const active = g === granularity;
              return (
                <button
                  key={g}
                  onClick={() => changeGranularity(g)}
                  disabled={pending}
                  style={{
                    padding: "0.3rem 0.95rem",
                    border: 0,
                    borderRadius: 999,
                    background: active ? "#fff" : "transparent",
                    color: active ? "#1a1f3a" : "rgba(255,255,255,0.7)",
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    cursor: pending ? "wait" : "pointer",
                    transition: "background 0.15s, color 0.15s",
                  }}
                >
                  {GRANULARITY_LABELS[g]}
                </button>
              );
            })}
          </div>

          <div data-sensitive style={{ textAlign: "right", marginTop: "0.25rem" }}>
            {(isAbove || isBelow) ? (
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.18)",
                  borderRadius: 999,
                  padding: "0.4rem 0.85rem",
                  fontSize: "0.85rem",
                  fontWeight: 500,
                }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    background: isAbove ? "#dc2626" : "#16a34a",
                    fontSize: "0.7rem",
                    fontWeight: 700,
                  }}
                >
                  {isAbove ? "↑" : "↓"}
                </span>
                <span>
                  {formatMoney(deltaAbs)} {isAbove ? "above" : "below"} last {granularity}
                </span>
              </div>
            ) : (
              <div style={{ fontSize: "0.85rem", opacity: 0.55 }}>
                On pace with last {granularity}
              </div>
            )}
            <div style={{ fontSize: "0.7rem", opacity: 0.45, marginTop: "0.35rem" }}>
              vs. {pacing.previousPeriodLabel} same point
            </div>
          </div>
        </div>

        {/* Chart */}
        <div data-sensitive style={{ marginTop: "0.5rem", marginLeft: -8, marginRight: -8 }}>
          <ResponsiveContainer width="100%" height={208}>
            <AreaChart
              data={chartData}
              margin={{ top: 2, right: 12, left: 8, bottom: -10 }}
              onClick={onChartClick}
              style={{ cursor: "pointer" }}
            >
              <defs>
                <linearGradient id="pacing-prev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ffffff" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="#ffffff" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="pacing-cur" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#93c5fd" stopOpacity={0.55} />
                  <stop offset="100%" stopColor="#93c5fd" stopOpacity={0.06} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="index"
                type="number"
                domain={[1, pacing.bucketCount]}
                ticks={pacing.xAxisTicks}
                tick={{ fontSize: 11, fill: "rgba(255,255,255,0.45)" }}
                tickMargin={0}
                axisLine={false}
                tickLine={false}
              />
              {/* Tight top headroom — default "auto" adds ~25% of headroom we don't need. */}
              <YAxis hide domain={[0, (dataMax: number) => Math.ceil(dataMax * 1.05)]} />
              {!obscured && (
                <Tooltip
                  contentStyle={{
                    background: "#0f1429",
                    border: "1px solid rgba(255,255,255,0.15)",
                    borderRadius: 8,
                    fontSize: 12,
                    color: "#fff",
                  }}
                  labelStyle={{ display: "none" }}
                  labelFormatter={() => ""}
                  formatter={(v, name, props) => {
                    const n = typeof v === "number" ? v : 0;
                    const row = (props as { payload?: { currentTooltipLabel: string; previousTooltipLabel: string } })?.payload;
                    const tipLabel = name === "current"
                      ? row?.currentTooltipLabel
                      : row?.previousTooltipLabel;
                    return [
                      `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                      tipLabel ?? "",
                    ];
                  }}
                />
              )}
              <Area
                type="monotone"
                dataKey="previous"
                stroke="rgba(255,255,255,0.45)"
                strokeWidth={1.5}
                fill="url(#pacing-prev)"
                isAnimationActive={false}
                connectNulls={false}
              />
              <Area
                type="monotone"
                dataKey="current"
                stroke="#93c5fd"
                strokeWidth={2}
                fill="url(#pacing-cur)"
                isAnimationActive={false}
                connectNulls={false}
              />
              {todayPoint && (
                <ReferenceDot
                  x={todayPoint.index}
                  y={todayPoint.value}
                  r={5}
                  fill="#93c5fd"
                  stroke="#1a1f3a"
                  strokeWidth={2}
                />
              )}
              {selectedBucket && (
                <ReferenceDot
                  x={selectedBucket.index}
                  y={
                    includeOneTime
                      ? selectedBucket.currentInclOneTime ?? selectedBucket.previousInclOneTime ?? 0
                      : selectedBucket.currentExclOneTime ?? selectedBucket.previousExclOneTime ?? 0
                  }
                  r={6}
                  fill="#fbbf24"
                  stroke="#1a1f3a"
                  strokeWidth={2}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Footer: legend + one-time toggle */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "0.75rem",
            fontSize: "0.75rem",
            opacity: 0.7,
            paddingTop: "0.5rem",
            borderTop: "1px solid rgba(255,255,255,0.08)",
            marginTop: "0.25rem",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
              <span
                style={{
                  display: "inline-block",
                  width: 12,
                  height: 3,
                  background: "#93c5fd",
                  borderRadius: 2,
                }}
              />
              {pacing.currentPeriodLabel} so far ({periodSubLabel(granularity)})
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
              <span
                style={{
                  display: "inline-block",
                  width: 12,
                  height: 3,
                  background: "rgba(255,255,255,0.45)",
                  borderRadius: 2,
                }}
              />
              {pacing.previousPeriodLabel} (<span data-sensitive>{formatDollarShort(
                includeOneTime ? pacing.previousFullPeriodInclOneTime : pacing.previousFullPeriodExclOneTime,
              )}</span>)
            </span>
          </div>
          <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={includeOneTime}
              onChange={(e) => setIncludeOneTime(e.target.checked)}
              style={{ accentColor: "#93c5fd", cursor: "pointer" }}
            />
            Include one-time purchases
          </label>
        </div>
      </section>

      {selectedBucket && (
        <PacingDrillDown
          currentFrom={selectedBucket.currentFrom}
          currentTo={selectedBucket.currentTo}
          previousFrom={selectedBucket.previousFrom}
          previousTo={selectedBucket.previousTo}
          currentLabel={`${pacing.currentPeriodLabel} · ${selectedBucket.label}`}
          previousLabel={`${pacing.previousPeriodLabel} · ${selectedBucket.previousLabel}`}
          profileIds={profileIds}
          accounts={accounts}
          availableTags={availableTags}
          availableCategories={availableCategories}
          profiles={profiles}
        />
      )}
    </div>
  );
}
