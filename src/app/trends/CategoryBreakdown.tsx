"use client";

import { useState, useRef, useCallback } from "react";
import type { CategoryTotal } from "../../lib/types.ts";
import { DashboardAccordionRow } from "./DashboardAccordionRow.tsx";
import { CategoryDrillDown } from "./CategoryDrillDown.tsx";
import { formatMoney } from "../../lib/format.ts";
import { categoryColor } from "../../lib/categoryColor.ts";

interface TooltipInfo {
  category: string;
  amount: number;
  pct: number;
  color: string;
  x: number;
  y: number;
}

interface Props {
  data: CategoryTotal[];
  comparisonData?: CategoryTotal[];
  selectedPeriodLabel?: string;
  comparisonPeriodLabel?: string;
  periodFrom: string;
  periodTo: string;
  comparisonPeriodFrom?: string;
  comparisonPeriodTo?: string;
  availableTags: { id: string; displayName: string }[];
  availableCategories: string[];
  emptyMessage?: string;
  profileIds: string[] | null;
  accounts: import("../transactions/BulkEditTable.tsx").AccountInfo[];
  profiles?: { id: string; displayName: string; color?: string }[];
  showApplesToggle?: boolean;
  apples?: boolean;
  onToggleApples?: (next: boolean) => void;
}

export default function CategoryBreakdown({
  data,
  comparisonData,
  selectedPeriodLabel,
  comparisonPeriodLabel,
  periodFrom,
  periodTo,
  comparisonPeriodFrom,
  comparisonPeriodTo,
  availableTags,
  availableCategories,
  emptyMessage,
  profileIds,
  accounts,
  profiles,
  showApplesToggle = false,
  apples = false,
  onToggleApples,
}: Props) {
  const [mode, setMode] = useState<"amount" | "pct">("amount");
  const [tooltip, setTooltip] = useState<TooltipInfo | null>(null);
  const [compTooltip, setCompTooltip] = useState<TooltipInfo | null>(null);
  const [selectedDrill, setSelectedDrill] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const compBarRef = useRef<HTMLDivElement>(null);

  const toggleDrill = useCallback((category: string) => {
    setSelectedDrill((prev) => (prev === category ? null : category));
  }, []);

  const handleSegmentEnter = useCallback(
    (
      e: React.MouseEvent<HTMLDivElement>,
      row: CategoryTotal,
      idx: number,
      total: number,
      containerRef: React.RefObject<HTMLDivElement | null>,
      setter: (t: TooltipInfo | null) => void,
    ) => {
      const rect = containerRef.current?.getBoundingClientRect();
      const segRect = e.currentTarget.getBoundingClientRect();
      if (!rect) return;
      setter({
        category: row.category || "Uncategorized",
        amount: row.total,
        pct: total > 0 ? (row.total / total) * 100 : 0,
        color: categoryColor(row.category || "Uncategorized", row.color),
        x: segRect.left - rect.left + segRect.width / 2,
        y: segRect.top - rect.top,
      });
    },
    [],
  );

  if (data.length === 0) {
    return (
      <div style={{ padding: "2.5rem", textAlign: "center", color: "#bbb", fontSize: "1.025rem" }}>
        {emptyMessage ?? "No spending data for this period."}
      </div>
    );
  }

  const total = data.reduce((s, d) => s + d.total, 0);
  const compTotal = comparisonData ? comparisonData.reduce((s, d) => s + d.total, 0) : 0;
  const maxTotal = Math.max(total, compTotal, 1);

  // Reorder comparison data to match the order of the selected month's data
  let orderedComparisonData = comparisonData;
  if (comparisonData) {
    const dataOrder = new Map(data.map((d, i) => [d.category || "Uncategorized", i]));
    orderedComparisonData = [...comparisonData].sort((a, b) => {
      const aCat = a.category || "Uncategorized";
      const bCat = b.category || "Uncategorized";
      const aIdx = dataOrder.get(aCat);
      const bIdx = dataOrder.get(bCat);
      
      if (aIdx !== undefined && bIdx !== undefined) return aIdx - bIdx;
      if (aIdx !== undefined) return -1;
      if (bIdx !== undefined) return 1;
      return b.total - a.total;
    });
  }

  // Build color map keyed by category name (so comparison bar matches)
  const categoryColorMap = new Map<string, string>();
  data.forEach((row) => {
    categoryColorMap.set(row.category || "Uncategorized", categoryColor(row.category || "Uncategorized", row.color));
  });
  // Assign colors to any comparison-only categories
  if (orderedComparisonData) {
    orderedComparisonData.forEach((row) => {
      const key = row.category || "Uncategorized";
      if (!categoryColorMap.has(key)) {
        categoryColorMap.set(key, categoryColor(key, row.color));
      }
    });
  }

  function renderStackedBar(
    items: CategoryTotal[],
    itemTotal: number,
    widthFraction: number,
    containerRef: React.RefObject<HTMLDivElement | null>,
    activeTooltip: TooltipInfo | null,
    setActiveTooltip: (t: TooltipInfo | null) => void,
    label?: string,
  ) {
    return (
      <div style={{ position: "relative" }} ref={containerRef}>
        {label && (
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: 6,
            fontSize: "0.875rem",
            fontWeight: 600,
            color: "#555",
          }}>
            <span>{label}</span>
            <span data-sensitive style={{ fontWeight: 700, color: "#333" }}>{formatMoney(itemTotal)}</span>
          </div>
        )}
        <div
          style={{
            display: "flex",
            height: 28,
            borderRadius: 7,
            overflow: "hidden",
            gap: 1,
            width: `${widthFraction * 100}%`,
            minWidth: 4,
            transition: "width 0.4s ease",
          }}
        >
          {items.map((row, i) => {
            const color = categoryColorMap.get(row.category || "Uncategorized") ?? categoryColor(row.category || "Uncategorized", row.color);
            const segCategory = row.category || "Uncategorized";
            const isDrillTarget = selectedDrill === segCategory;
            const someOtherDrillSelected =
              selectedDrill != null && selectedDrill !== segCategory;
            return (
              <div
                key={row.category}
                onClick={() => toggleDrill(segCategory)}
                onMouseEnter={(e) =>
                  handleSegmentEnter(e, row, i, itemTotal, containerRef, setActiveTooltip)
                }
                onMouseMove={(e) =>
                  handleSegmentEnter(e, row, i, itemTotal, containerRef, setActiveTooltip)
                }
                onMouseLeave={() => setActiveTooltip(null)}
                style={{
                  flex: row.total / itemTotal,
                  background: color,
                  minWidth: 2,
                  cursor: "pointer",
                  transition: "opacity 0.1s",
                  outline: isDrillTarget ? "2px solid #1e293b" : "none",
                  outlineOffset: -2,
                  opacity:
                    activeTooltip && activeTooltip.category !== segCategory
                      ? 0.55
                      : someOtherDrillSelected
                        ? 0.45
                        : 1,
                }}
              />
            );
          })}
        </div>

        {/* Tooltip */}
        {activeTooltip && (
          <div
            style={{
              position: "absolute",
              left: activeTooltip.x,
              top: activeTooltip.y - 8,
              transform: "translate(-50%, -100%)",
              background: "#1e293b",
              color: "white",
              padding: "0.45rem 0.65rem",
              borderRadius: 8,
              fontSize: "0.905rem",
              whiteSpace: "nowrap",
              pointerEvents: "none",
              zIndex: 20,
              boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: activeTooltip.color,
                flexShrink: 0,
              }}
            />
            <span style={{ fontWeight: 600 }}>{activeTooltip.category}</span>
            <span data-sensitive style={{ opacity: 0.9 }}>{formatMoney(activeTooltip.amount)}</span>
            <span style={{ opacity: 0.6 }}>{activeTooltip.pct.toFixed(1)}%</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ padding: "1.25rem" }}>

      {/* Comparison bars (if comparison data provided) */}
      {comparisonData && comparisonData.length > 0 ? (
        <div style={{ marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              {renderStackedBar(
                data,
                total,
                total / maxTotal,
                barRef,
                tooltip,
                setTooltip,
                selectedPeriodLabel ?? "Selected",
              )}
              {selectedDrill && (
                <CategoryDrillDown
                  category={selectedDrill}
                  periodFrom={periodFrom}
                  periodTo={periodTo}
                  profileIds={profileIds}
                  accounts={accounts}
                  availableTags={availableTags}
                  availableCategories={availableCategories}
                  profiles={profiles}
                />
              )}
            </div>
            <div>
              {renderStackedBar(
                orderedComparisonData!,
                compTotal,
                compTotal / maxTotal,
                compBarRef,
                compTooltip,
                setCompTooltip,
                comparisonPeriodLabel ?? "Previous",
              )}
              {selectedDrill && comparisonPeriodFrom && comparisonPeriodTo && (
                <CategoryDrillDown
                  category={selectedDrill}
                  periodFrom={comparisonPeriodFrom}
                  periodTo={comparisonPeriodTo}
                  profileIds={profileIds}
                  accounts={accounts}
                  availableTags={availableTags}
                  availableCategories={availableCategories}
                  profiles={profiles}
                />
              )}
            </div>
          </div>
          {showApplesToggle && onToggleApples && (
            <label style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginTop: "0.75rem",
              fontSize: "0.8rem",
              color: "#555",
              cursor: "pointer",
            }}>
              <input
                type="checkbox"
                checked={apples}
                onChange={(e) => onToggleApples(e.target.checked)}
                style={{ cursor: "pointer" }}
              />
              Compare same point in prior period
            </label>
          )}
        </div>
      ) : (
        /* Single stacked bar (no comparison data) */
        <div style={{ marginBottom: "1.25rem" }}>
          {renderStackedBar(data, total, 1, barRef, tooltip, setTooltip)}
          {selectedDrill && (
            <CategoryDrillDown
              category={selectedDrill}
              periodFrom={periodFrom}
              periodTo={periodTo}
              profileIds={profileIds}
              accounts={accounts}
              availableTags={availableTags}
              availableCategories={availableCategories}
              profiles={profiles}
            />
          )}
        </div>
      )}

      {/* $ / % toggle */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "0.75rem" }}>
        <div style={{ display: "flex", background: "#f3f4f6", borderRadius: 6, padding: 2, gap: 2 }}>
          {(["amount", "pct"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                padding: "0.2rem 0.6rem",
                border: "none",
                borderRadius: 4,
                background: mode === m ? "white" : "transparent",
                boxShadow: mode === m ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                cursor: "pointer",
                fontWeight: mode === m ? 600 : 400,
                color: mode === m ? "#111" : "#888",
                fontSize: "0.875rem",
                transition: "background 0.1s",
              }}
            >
              {m === "amount" ? "$" : "%"}
            </button>
          ))}
        </div>
      </div>

      {/* Category rows */}
      {data.map((row, i) => {
        const pct = total > 0 ? (row.total / total) * 100 : 0;
        const color = categoryColorMap.get(row.category || "Uncategorized") ?? categoryColor(row.category || "Uncategorized", row.color);
        return (
          <DashboardAccordionRow
            key={row.category || "Uncategorized"}
            category={row.category}
            total={row.total}
            pct={pct}
            color={color}
            icon={row.icon}
            mode={mode}
            isLast={i === data.length - 1}
            periodFrom={periodFrom}
            periodTo={periodTo}
            availableTags={availableTags}
            availableCategories={availableCategories}
            profileIds={profileIds}
            accounts={accounts}
            profiles={profiles}
          />
        );
      })}

      {/* Total row */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        marginTop: "0.75rem",
        paddingTop: "0.75rem",
        borderTop: "1px solid #f0f0f0",
        fontWeight: 600,
        fontSize: "1.025rem",
      }}>
        <span>Total</span>
        <span data-sensitive>{formatMoney(total)}</span>
      </div>
    </div>
  );
}
