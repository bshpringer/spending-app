"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import type { PeriodTotal, CategoryTotal, TagTotal, MerchantTotal } from "../../lib/types.ts";
import type { Granularity } from "../../lib/period.ts";
import { formatPeriodShort, formatPeriodYear } from "../../lib/period.ts";
import CategoryBreakdown from "./CategoryBreakdown.tsx";
import TagBreakdown from "./TagBreakdown.tsx";
import { formatMoney } from "../../lib/format.ts";

interface Props {
  granularity: Granularity;
  periodTotals: PeriodTotal[];
  categoryBreakdown: CategoryTotal[];
  comparisonBreakdown: CategoryTotal[];
  tagBreakdown: TagTotal[];
  merchantBreakdown: MerchantTotal[];
  selectedPeriod: string;
  selectedPeriodLabel: string;
  comparisonPeriodLabel: string;
  selectedPeriodData: PeriodTotal;
  activeTagIds: string[];
  activeAccountIds: string[];
  availableTags: { id: string; displayName: string }[];
  availableCategories: string[];
  view?: "spending" | "income";
  profileParam?: string;
  profileIds: string[] | null;
  accountInfos: import("../transactions/BulkEditTable.tsx").AccountInfo[];
  profileOptions: { id: string; displayName: string; color?: string }[];
  excludeOneTime?: boolean;
  oneTimeByPeriod?: Record<string, number>;
  periodFrom: string;
  periodTo: string;
  comparisonPeriodFrom?: string;
  comparisonPeriodTo?: string;
  apples: boolean;
  showApplesToggle: boolean;
}

const HEADER_BG = "#1a1f3a";

const GRANULARITIES: { key: Granularity; label: string }[] = [
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "quarter", label: "Quarter" },
  { key: "year", label: "Year" },
];

function barWidthFor(g: Granularity): number {
  switch (g) {
    case "week": return 42;
    case "month": return 60;
    case "quarter": return 64;
    case "year": return 80;
  }
}

export default function DashboardClient({
  granularity,
  periodTotals,
  categoryBreakdown,
  comparisonBreakdown,
  tagBreakdown,
  merchantBreakdown,
  selectedPeriod,
  selectedPeriodLabel,
  comparisonPeriodLabel,
  selectedPeriodData,
  activeTagIds,
  activeAccountIds,
  availableTags,
  availableCategories,
  view = "spending",
  profileParam,
  profileIds,
  accountInfos,
  profileOptions,
  excludeOneTime = true,
  oneTimeByPeriod = {},
  periodFrom,
  periodTo,
  comparisonPeriodFrom,
  comparisonPeriodTo,
  apples,
  showApplesToggle,
}: Props) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"categories" | "tags">("categories");
  const [tooltipInfo, setTooltipInfo] = useState<{ period: string; income: number; spend: number; x: number; y: number } | null>(null);
  const basePath = view === "income" ? "/trends/income" : "/trends";
  const title = view === "income" ? "Income" : "Spending";
  const selectedRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [selectedPeriod]);

  // Show periods chronologically left-to-right
  const chronological = [...periodTotals].reverse();

  // Use 85th-percentile clamped scale so outlier periods don't crush normal ones.
  const allVals = chronological.flatMap((p) => [p.income, p.spend]).filter(v => v > 0).sort((a, b) => a - b);
  const p85Idx = Math.floor(allVals.length * 0.85);
  const p85 = allVals.length > 0 ? allVals[Math.min(p85Idx, allVals.length - 1)] : 1;
  const scaleMax = Math.max(p85 * 1.15, 1);

  const net = selectedPeriodData.income - selectedPeriodData.spend;
  const barWidth = barWidthFor(granularity);

  function buildBaseParams(): URLSearchParams {
    const p = new URLSearchParams();
    if (activeTagIds.length) p.set("tagIds", activeTagIds.join(","));
    if (activeAccountIds.length) p.set("accountIds", activeAccountIds.join(","));
    if (profileParam) p.set("profile", profileParam);
    if (!excludeOneTime) p.set("includeOneTime", "1");
    return p;
  }

  function gotoPeriod(period: string) {
    const p = buildBaseParams();
    p.set("period", period);
    if (granularity !== "month") p.set("granularity", granularity);
    if (apples !== showApplesToggle) p.set("apples", apples ? "1" : "0");
    router.replace(`${basePath}?${p.toString()}`);
  }

  function gotoGranularity(g: Granularity) {
    const p = buildBaseParams();
    if (g !== "month") p.set("granularity", g);
    router.replace(`${basePath}?${p.toString()}`);
  }

  function toggleApples(next: boolean) {
    const p = buildBaseParams();
    p.set("period", selectedPeriod);
    if (granularity !== "month") p.set("granularity", granularity);
    p.set("apples", next ? "1" : "0");
    router.replace(`${basePath}?${p.toString()}`);
  }

  function siblingHref(targetBase: string): string {
    const p = buildBaseParams();
    p.set("period", selectedPeriod);
    if (granularity !== "month") p.set("granularity", granularity);
    return `${targetBase}?${p.toString()}`;
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f4f5f7", fontFamily: "system-ui, -apple-system, sans-serif" }}>

      {/* ── Dark header (Title + Granularity pills) ── */}
      <div style={{ background: HEADER_BG, color: "white", paddingTop: "1.5rem" }}>
        <div style={{ maxWidth: 800, margin: "0 auto", padding: "0 0.5rem 1rem" }}>
          <h1 style={{ textAlign: "center", fontSize: "1.225rem", fontWeight: 600, margin: "0 0 0.75rem", letterSpacing: "0.02em" }}>
            {title}
          </h1>
          <div style={{ display: "flex", justifyContent: "center", gap: 4 }}>
            {GRANULARITIES.map((g) => {
              const active = g.key === granularity;
              return (
                <button
                  key={g.key}
                  onClick={() => gotoGranularity(g.key)}
                  style={{
                    background: active ? "rgba(255,255,255,0.18)" : "transparent",
                    color: active ? "white" : "rgba(255,255,255,0.55)",
                    border: `1px solid ${active ? "rgba(255,255,255,0.35)" : "transparent"}`,
                    borderRadius: 999,
                    padding: "0.3rem 0.85rem",
                    fontSize: "0.825rem",
                    fontWeight: active ? 600 : 400,
                    cursor: "pointer",
                    transition: "background 0.15s, color 0.15s",
                  }}
                >
                  {g.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Sticky Period selector + Legend ── */}
      <div style={{
        position: "sticky",
        top: 54,
        zIndex: 20,
        background: HEADER_BG,
        color: "white",
        boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
      }}>
        <div style={{ maxWidth: 800, margin: "0 auto", padding: "0 0.5rem", position: "relative" }}>
          <button
            onClick={() => scrollRef.current?.scrollBy({ left: -250, behavior: "smooth" })}
            style={{
              position: "absolute", left: -10, top: 70, zIndex: 10,
              width: 28, height: 28, borderRadius: "50%",
              background: "rgba(0,0,0,0.5)", color: "white", border: "1px solid rgba(255,255,255,0.2)",
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 2px 4px rgba(0,0,0,0.2)"
            }}
            aria-label="Scroll left"
          >
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>

          <div
            ref={scrollRef}
            style={{
              overflowX: "auto",
              display: "flex",
              paddingBottom: "0.5rem",
              scrollbarWidth: "none",
              msOverflowStyle: "none",
            }}
          >
            {chronological.map((p, i) => {
              const isSelected = p.period === selectedPeriod;
              const incRatio = Math.min(p.income / scaleMax, 1);
              const spendRatio = Math.min(p.spend / scaleMax, 1);
              const incH = p.income > 0 ? Math.max(4, incRatio * 66) : 4;
              const spendH = p.spend > 0 ? Math.max(4, spendRatio * 66) : 4;
              const incClamped = p.income > scaleMax;
              const spendClamped = p.spend > scaleMax;
              const yearChanged = i === 0 || formatPeriodYear(p.period, granularity) !== formatPeriodYear(chronological[i - 1].period, granularity);

              return (
                <button
                  key={p.period}
                  ref={isSelected ? selectedRef : undefined}
                  onClick={() => gotoPeriod(p.period)}
                  onMouseEnter={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setTooltipInfo({ period: p.period, income: p.income, spend: p.spend, x: rect.left + rect.width / 2, y: rect.top + 14 });
                  }}
                  onMouseLeave={() => setTooltipInfo(null)}
                  style={{
                    flexShrink: 0,
                    width: barWidth,
                    background: "none",
                    border: `2px solid ${isSelected ? "rgba(255,255,255,0.75)" : "transparent"}`,
                    borderRadius: 10,
                    cursor: "pointer",
                    padding: "0.35rem 0.3rem 0.45rem",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    color: isSelected ? "white" : "rgba(255,255,255,0.5)",
                    transition: "border-color 0.15s, color 0.15s",
                    position: "relative",
                  }}
                >
                  {yearChanged ? (
                    <span style={{ fontSize: "0.675rem", opacity: 0.6, marginBottom: 2, letterSpacing: "0.04em" }}>
                      {formatPeriodYear(p.period, granularity)}
                    </span>
                  ) : (
                    <span style={{ fontSize: "0.675rem", marginBottom: 2 }}>&nbsp;</span>
                  )}

                  <div style={{ display: "flex", gap: 4, alignItems: "flex-end", height: 70, marginBottom: 5 }}>
                    <div style={{
                      width: 9,
                      height: incH,
                      background: incClamped
                        ? "linear-gradient(to top, rgba(255,255,255,0.85) 80%, rgba(255,200,100,0.95) 100%)"
                        : "rgba(255,255,255,0.85)",
                      borderRadius: "3px 3px 1px 1px",
                    }} />
                    <div style={{
                      width: 9,
                      height: spendH,
                      borderRadius: "3px 3px 1px 1px",
                      background: spendClamped
                        ? "linear-gradient(to top, repeating-linear-gradient(to bottom, rgba(255,255,255,0.5) 0px, rgba(255,255,255,0.5) 3px, rgba(255,255,255,0.12) 3px, rgba(255,255,255,0.12) 6px) 80%, rgba(255,200,100,0.95) 100%)"
                        : "repeating-linear-gradient(to bottom, rgba(255,255,255,0.5) 0px, rgba(255,255,255,0.5) 3px, rgba(255,255,255,0.12) 3px, rgba(255,255,255,0.12) 6px)",
                    }} />
                  </div>

                  <span style={{ fontSize: granularity === "week" ? "0.7rem" : "0.775rem", fontWeight: isSelected ? 600 : 400, position: "relative", whiteSpace: "nowrap" }}>
                    {formatPeriodShort(p.period, granularity)}
                    {excludeOneTime && oneTimeByPeriod[p.period] > 0 && (
                      <span style={{
                        position: "absolute",
                        bottom: -10,
                        left: "50%",
                        transform: "translateX(-50%)",
                        width: 4,
                        height: 4,
                        borderRadius: "50%",
                        background: "#f59e0b",
                      }} />
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          {tooltipInfo && (
            <div
              style={{
                position: "fixed",
                top: tooltipInfo.y,
                left: tooltipInfo.x,
                transform: "translateX(-50%)",
                background: "#0f172a",
                border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: 8,
                padding: "0.4rem 0.6rem",
                whiteSpace: "nowrap",
                fontSize: "0.78rem",
                zIndex: 9999,
                pointerEvents: "none",
                boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
                color: "white",
                display: "flex",
                flexDirection: "column",
                gap: 3,
              }}
            >
              <div data-sensitive style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "rgba(255,255,255,0.85)", flexShrink: 0 }} />
                <span style={{ opacity: 0.65 }}>In</span>
                <span style={{ fontWeight: 600, marginLeft: "auto" }}>{formatMoney(tooltipInfo.income)}</span>
              </div>
              <div data-sensitive style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", border: "1px dashed rgba(255,255,255,0.6)", flexShrink: 0 }} />
                <span style={{ opacity: 0.65 }}>Out</span>
                <span style={{ fontWeight: 600, marginLeft: "auto" }}>{formatMoney(tooltipInfo.spend)}</span>
              </div>
            </div>
          )}

          <button
            onClick={() => scrollRef.current?.scrollBy({ left: 250, behavior: "smooth" })}
            style={{
              position: "absolute", right: -10, top: 70, zIndex: 10,
              width: 28, height: 28, borderRadius: "50%",
              background: "rgba(0,0,0,0.5)", color: "white", border: "1px solid rgba(255,255,255,0.2)",
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 2px 4px rgba(0,0,0,0.2)"
            }}
            aria-label="Scroll right"
          >
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>

          <div style={{ display: "flex", gap: "1.5rem", justifyContent: "center", padding: "0.75rem 0 0.5rem", fontSize: "0.845rem", opacity: 0.7 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "rgba(255,255,255,0.85)", display: "inline-block" }} />
              Income
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 8, height: 8, border: "1.5px dashed rgba(255,255,255,0.65)", borderRadius: "50%", display: "inline-block" }} />
              Total Spend
            </span>
            <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", marginLeft: "1rem" }}>
              <input
                type="checkbox"
                checked={!excludeOneTime}
                onChange={(e) => {
                  const p = new URLSearchParams(window.location.search);
                  if (e.target.checked) p.set("includeOneTime", "1");
                  else p.delete("includeOneTime");
                  router.replace(`${basePath}?${p.toString()}`);
                }}
                style={{ cursor: "pointer" }}
              />
              Include one-time purchases
            </label>
          </div>
        </div>
      </div>

      <div style={{ height: "2rem", background: HEADER_BG }} />

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 1rem 2rem", position: "relative", zIndex: 10 }}>

        <div style={{
          background: "white",
          borderRadius: 16,
          boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
          marginTop: "-1.75rem",
          overflow: "hidden",
          marginBottom: "1.5rem",
        }}>
          <div style={{
            padding: "0.65rem 1.25rem",
            fontSize: "0.825rem",
            fontWeight: 600,
            color: "#6b7280",
            letterSpacing: "0.02em",
            borderBottom: "1px solid #f3f4f6",
            background: "#fafbfc",
          }}>
            {selectedPeriodLabel}
          </div>
          {([
            { label: "Income", value: selectedPeriodData.income, color: "#111", linkTo: view === "spending" ? "/trends/income" : null },
            { label: "Total Spend", value: selectedPeriodData.spend, color: "#111", linkTo: view === "income" ? "/trends" : null },
            { label: "Net Income", value: net, color: net >= 0 ? "#16a34a" : "#dc2626", linkTo: null },
          ] as const).map((row, i, arr) => {
            const isActive = (view === "income" && row.label === "Income") || (view === "spending" && row.label === "Total Spend");
            const hasOneTime = row.label === "Total Spend" && excludeOneTime && oneTimeByPeriod[selectedPeriod] > 0;

            const content = (
              <>
                <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                  <span style={{ fontWeight: 500, color: isActive ? "#888" : undefined }}>{row.label}</span>
                  {hasOneTime && (
                    <span style={{ fontSize: "0.75rem", color: "#f59e0b", marginTop: 2 }}>
                      +{formatMoney(oneTimeByPeriod[selectedPeriod])} one-time hidden
                    </span>
                  )}
                </div>
                <span data-sensitive style={{ fontWeight: 700, fontSize: "1.175rem", color: row.color }}>
                  {formatMoney(row.value)}
                </span>
                {row.linkTo && (
                  <span aria-hidden style={{ marginLeft: "0.6rem", color: "#9ca3af", fontSize: "1.05rem" }}>›</span>
                )}
              </>
            );
            const rowStyle: React.CSSProperties = {
              display: "flex",
              alignItems: "center",
              padding: "1rem 1.25rem",
              borderBottom: i < arr.length - 1 ? "1px solid #f3f4f6" : "none",
              color: "inherit",
              textDecoration: "none",
              background: isActive ? "#f9fafb" : "transparent",
            };
            if (row.linkTo) {
              return (
                <Link key={row.label} href={siblingHref(row.linkTo)} style={{ ...rowStyle, cursor: "pointer" }}>
                  {content}
                </Link>
              );
            }
            return (
              <div key={row.label} style={rowStyle}>
                {content}
              </div>
            );
          })}
        </div>

        <div style={{ fontSize: "0.825rem", fontWeight: 700, letterSpacing: "0.1em", color: "#888", marginBottom: "0.75rem" }}>
          BREAKDOWN
        </div>
        <div style={{ background: "white", borderRadius: 16, boxShadow: "0 2px 12px rgba(0,0,0,0.08)", overflow: "hidden", marginBottom: "1.5rem" }}>

          <div style={{ display: "flex", borderBottom: "1px solid #f3f4f6" }}>
            {(view === "income" ? (["categories"] as const) : (["categories", "tags"] as const)).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  flex: 1,
                  padding: "0.875rem",
                  background: "none",
                  border: "none",
                  borderBottom: activeTab === tab ? `2px solid ${HEADER_BG}` : "2px solid transparent",
                  marginBottom: -1,
                  fontWeight: activeTab === tab ? 600 : 400,
                  color: activeTab === tab ? HEADER_BG : "#888",
                  cursor: "pointer",
                  fontSize: "1.025rem",
                }}
              >
                {tab === "categories" ? "Categories" : "Tags"}
              </button>
            ))}
          </div>

          {activeTab === "categories" || view === "income"
            ? <CategoryBreakdown
                data={categoryBreakdown}
                comparisonData={comparisonBreakdown}
                selectedPeriodLabel={selectedPeriodLabel}
                comparisonPeriodLabel={comparisonPeriodLabel}
                periodFrom={periodFrom}
                periodTo={periodTo}
                comparisonPeriodFrom={comparisonPeriodFrom}
                comparisonPeriodTo={comparisonPeriodTo}
                availableTags={availableTags}
                availableCategories={availableCategories}
                emptyMessage={view === "income" ? "No income data for this period." : undefined}
                profileIds={profileIds}
                accounts={accountInfos}
                profiles={profileOptions}
                showApplesToggle={showApplesToggle}
                apples={apples}
                onToggleApples={toggleApples}
              />
            : <TagBreakdown data={tagBreakdown} />}
        </div>

        {view === "spending" && merchantBreakdown.length > 0 && (
          <>
            <div style={{ fontSize: "0.825rem", fontWeight: 700, letterSpacing: "0.1em", color: "#888", marginBottom: "0.75rem" }}>
              FREQUENT MERCHANTS
            </div>
            <div style={{ background: "white", borderRadius: 16, boxShadow: "0 2px 12px rgba(0,0,0,0.08)", overflow: "hidden" }}>
              {merchantBreakdown.map((m, i) => {
                const avg = m.total / m.count;
                const merchantHref = profileParam
                  ? `/merchants/${encodeURIComponent(m.merchant)}?profile=${encodeURIComponent(profileParam)}`
                  : `/merchants/${encodeURIComponent(m.merchant)}`;
                return (
                  <Link
                    key={m.merchant}
                    href={merchantHref}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      padding: "0.875rem 1.25rem",
                      borderBottom: i < merchantBreakdown.length - 1 ? "1px solid #f3f4f6" : "none",
                      color: "inherit",
                      textDecoration: "none",
                    }}
                  >
                    <span data-sensitive style={{ flex: 1, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginRight: "0.75rem" }} title={m.merchant}>
                      {m.merchant}
                    </span>
                    <span style={{ opacity: 0.55, fontSize: "0.875rem", marginRight: "0.85rem", whiteSpace: "nowrap" }}>
                      ×{m.count} · <span data-sensitive>{formatMoney(avg)}</span> avg
                    </span>
                    <span data-sensitive style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                      {formatMoney(m.total)}
                    </span>
                    <span aria-hidden style={{ marginLeft: "0.6rem", color: "#9ca3af", fontSize: "1.05rem" }}>›</span>
                  </Link>
                );
              })}
            </div>
          </>
        )}

      </div>
    </div>
  );
}
