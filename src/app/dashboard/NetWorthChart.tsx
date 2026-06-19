"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { formatMoney } from "@/lib/format.ts";
import type { LatestAccountBalance } from "@/lib/repo/plaidBalanceRepo.ts";
import {
  ACCOUNT_GROUP_IS_LIABILITY,
  defaultGroupFromPlaid,
  isAccountGroup,
  type AccountGroup,
} from "@/lib/accountGroups.ts";

export interface DailyBalanceRow {
  plaidAccountId: string;
  day: string; // YYYY-MM-DD
  current: number | null;
}

type Range = "30d" | "1y" | "all";

const RANGES: { key: Range; label: string; days: number | null }[] = [
  { key: "30d", label: "30d", days: 30 },
  { key: "1y", label: "1y", days: 365 },
  { key: "all", label: "All", days: null },
];

interface Props {
  daily: DailyBalanceRow[];
  balances: LatestAccountBalance[];
  included: Set<AccountGroup>;
  netWorth: number;
}

function resolveGroup(b: LatestAccountBalance): AccountGroup {
  if (isAccountGroup(b.accountGroup)) return b.accountGroup;
  return defaultGroupFromPlaid(b.plaidType, b.plaidSubtype);
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Add one calendar day to a YYYY-MM-DD string. */
function nextDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function formatDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatDollarShort(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${Math.round(n)}`;
}

interface DayPoint { day: string; netWorth: number }

/**
 * Build a continuous daily Net Worth series, forward-filling each account's
 * last known balance and summing against `included` groups (liabilities
 * negated).
 *
 * Returns empty when no included account ever reports.
 */
function buildSeries(
  daily: DailyBalanceRow[],
  accountMeta: Map<string, { group: AccountGroup; isLiability: boolean }>,
  included: Set<AccountGroup>,
): DayPoint[] {
  if (daily.length === 0) return [];

  // Per-account lookup: day -> value
  const byAccount = new Map<string, Map<string, number>>();
  for (const row of daily) {
    if (row.current == null) continue;
    const meta = accountMeta.get(row.plaidAccountId);
    if (!meta) continue;
    if (!included.has(meta.group)) continue;
    let m = byAccount.get(row.plaidAccountId);
    if (!m) {
      m = new Map();
      byAccount.set(row.plaidAccountId, m);
    }
    m.set(row.day, row.current);
  }

  if (byAccount.size === 0) return [];

  // Continuous range: earliest day across accounts → today.
  const firstDay = daily.reduce((min, r) => (r.day < min ? r.day : min), daily[0].day);
  const lastDay = todayISO();
  if (firstDay > lastDay) return [];

  const lastSeen = new Map<string, number>();
  const series: DayPoint[] = [];
  let day = firstDay;
  // Cap loop iterations defensively (~10 years of days).
  for (let i = 0; i < 4000 && day <= lastDay; i++) {
    let started = false;
    let sum = 0;
    for (const [accId, m] of byAccount.entries()) {
      const v = m.get(day);
      if (v !== undefined) lastSeen.set(accId, v);
      const carried = lastSeen.get(accId);
      if (carried === undefined) continue;
      started = true;
      const meta = accountMeta.get(accId)!;
      sum += meta.isLiability ? -carried : carried;
    }
    if (started) series.push({ day, netWorth: sum });
    day = nextDay(day);
  }
  return series;
}

export function NetWorthChart({ daily, balances, included, netWorth }: Props) {
  const [range, setRange] = useState<Range>("30d");
  const [obscured, setObscured] = useState(false);

  useEffect(() => {
    setObscured(document.body.classList.contains("obscure-mode"));
    const observer = new MutationObserver(() => {
      setObscured(document.body.classList.contains("obscure-mode"));
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const accountMeta = useMemo(() => {
    const m = new Map<string, { group: AccountGroup; isLiability: boolean }>();
    for (const b of balances) {
      const g = resolveGroup(b);
      m.set(b.plaidAccountId, { group: g, isLiability: ACCOUNT_GROUP_IS_LIABILITY[g] });
    }
    return m;
  }, [balances]);

  const fullSeries = useMemo(
    () => buildSeries(daily, accountMeta, included),
    [daily, accountMeta, included],
  );

  const clippedSeries = useMemo(() => {
    if (fullSeries.length === 0) return [];
    const r = RANGES.find((x) => x.key === range)!;
    if (r.days == null) return fullSeries;
    return fullSeries.slice(-r.days);
  }, [fullSeries, range]);

  const latest = fullSeries.length > 0 ? fullSeries[fullSeries.length - 1] : null;
  const earliest = clippedSeries.length > 0 ? clippedSeries[0] : null;
  const delta = latest && earliest ? latest.netWorth - earliest.netWorth : 0;
  const deltaAbs = Math.abs(delta);
  const isUp = delta > 0.005;
  const isDown = delta < -0.005;

  const tooFewPoints = fullSeries.length < 2;

  return (
    <section
      style={{
        background: "#1a1f3a",
        color: "#fff",
        borderRadius: 12,
        padding: "1.5rem 2rem 1.25rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.75rem",
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
              fontSize: "0.8rem",
              opacity: 0.6,
              marginBottom: "0.35rem",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              fontWeight: 600,
            }}
          >
            Net Worth over time
          </div>
          <div
            data-sensitive
            style={{
              fontSize: "2.75rem",
              fontWeight: 700,
              letterSpacing: "-0.02em",
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1.05,
            }}
          >
            {formatMoney(netWorth)}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.6rem" }}>
          <div style={{ display: "flex", gap: 4 }}>
            {RANGES.map((r) => {
              const active = r.key === range;
              return (
                <button
                  key={r.key}
                  onClick={() => setRange(r.key)}
                  style={{
                    background: active ? "rgba(255,255,255,0.18)" : "transparent",
                    color: active ? "#fff" : "rgba(255,255,255,0.55)",
                    border: `1px solid ${active ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.12)"}`,
                    borderRadius: 999,
                    padding: "0.3rem 0.75rem",
                    fontSize: "0.78rem",
                    fontWeight: active ? 600 : 400,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    transition: "background 0.15s, color 0.15s",
                  }}
                >
                  {r.label}
                </button>
              );
            })}
          </div>
          {latest && (
            <div
              data-sensitive
              style={{
                fontSize: "0.9rem",
                fontVariantNumeric: "tabular-nums",
                textAlign: "right",
              }}
            >
              {(isUp || isDown) ? (
                <>
                  <span style={{ color: isUp ? "#86efac" : "#fca5a5", fontWeight: 600 }}>
                    {isUp ? "↑" : "↓"} {formatMoney(deltaAbs)}
                  </span>{" "}
                  <span style={{ opacity: 0.7 }}>
                    over {range === "all" ? "history" : range === "1y" ? "1 year" : "30 days"}
                  </span>
                </>
              ) : (
                <span style={{ opacity: 0.6 }}>Flat over {range === "all" ? "history" : range === "1y" ? "1 year" : "30 days"}</span>
              )}
            </div>
          )}
        </div>
      </div>

      {tooFewPoints ? (
        <div
          style={{
            height: 160,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "0.85rem",
            opacity: 0.55,
            textAlign: "center",
          }}
        >
          Chart will populate as balance snapshots accumulate.<br />
          {fullSeries.length === 1 && (
            <span style={{ fontSize: "0.75rem", opacity: 0.7 }}>
              First snapshot: {formatDay(fullSeries[0].day)}
            </span>
          )}
        </div>
      ) : (
        <div data-sensitive style={{ marginLeft: -8, marginRight: -8 }}>
          <ResponsiveContainer width="100%" height={170}>
            <AreaChart data={clippedSeries} margin={{ top: 6, right: 12, left: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="netWorth-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#93c5fd" stopOpacity={0.55} />
                  <stop offset="100%" stopColor="#93c5fd" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="day"
                tick={{ fontSize: 11, fill: "rgba(255,255,255,0.45)" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={formatDay}
                minTickGap={40}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "rgba(255,255,255,0.45)" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={formatDollarShort}
                width={48}
                domain={["auto", "auto"]}
              />
              {!obscured && (
                <Tooltip
                  contentStyle={{
                    background: "#0f1429",
                    border: "1px solid rgba(255,255,255,0.15)",
                    borderRadius: 8,
                    fontSize: 12,
                    color: "#fff",
                  }}
                  labelStyle={{ color: "rgba(255,255,255,0.6)", fontSize: 11 }}
                  labelFormatter={(lbl) => formatDay(String(lbl))}
                  formatter={(v) => {
                    const n = typeof v === "number" ? v : 0;
                    return [
                      `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                      "Net Worth",
                    ];
                  }}
                />
              )}
              <Area
                type="monotone"
                dataKey="netWorth"
                stroke="#93c5fd"
                strokeWidth={2}
                fill="url(#netWorth-fill)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
