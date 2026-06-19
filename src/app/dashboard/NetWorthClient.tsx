"use client";

import { useEffect, useMemo, useState } from "react";
import { formatMoney } from "@/lib/format.ts";
import type { LatestAccountBalance } from "@/lib/repo/plaidBalanceRepo.ts";
import {
  ACCOUNT_GROUPS,
  ACCOUNT_GROUP_LABELS,
  ACCOUNT_GROUP_IS_LIABILITY,
  DEFAULT_LIQUID_EXCLUDED,
  defaultGroupFromPlaid,
  isAccountGroup,
  type AccountGroup,
} from "@/lib/accountGroups.ts";
import { NetWorthChart, type DailyBalanceRow } from "./NetWorthChart.tsx";

const LS_KEY = "netWorth.includedGroups.v1";

// Resolve the group for a balance row: prefer the user-set accountGroup, fall
// back to a Plaid-derived default for legacy rows that predate the migration.
function resolveGroup(b: LatestAccountBalance): AccountGroup {
  if (isAccountGroup(b.accountGroup)) return b.accountGroup;
  return defaultGroupFromPlaid(b.plaidType, b.plaidSubtype);
}

function formatAsOf(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 2) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

function accountDisplayName(b: LatestAccountBalance): string {
  return b.customName ?? b.accountName;
}

function accountSubtitle(b: LatestAccountBalance): string {
  const parts: string[] = [];
  if (b.institutionDisplayName) parts.push(b.institutionDisplayName);
  if (b.accountNumberLast4) parts.push(`··${b.accountNumberLast4}`);
  if (b.plaidSubtype) parts.push(b.plaidSubtype);
  return parts.join(" · ");
}

interface Props {
  balances: LatestAccountBalance[];
  daily: DailyBalanceRow[];
}

interface GroupBucket {
  group: AccountGroup;
  label: string;
  isLiability: boolean;
  items: LatestAccountBalance[];
  total: number;
}

function buildGroups(balances: LatestAccountBalance[]): GroupBucket[] {
  const map = new Map<AccountGroup, LatestAccountBalance[]>();
  for (const b of balances) {
    const g = resolveGroup(b);
    if (!map.has(g)) map.set(g, []);
    map.get(g)!.push(b);
  }
  return ACCOUNT_GROUPS.flatMap((group) => {
    const items = map.get(group);
    if (!items || items.length === 0) return [];
    const total = items.reduce((sum, b) => sum + (b.current ?? 0), 0);
    return [{
      group,
      label: ACCOUNT_GROUP_LABELS[group],
      isLiability: ACCOUNT_GROUP_IS_LIABILITY[group],
      items,
      total,
    }];
  });
}

function loadIncluded(allGroups: AccountGroup[]): Set<AccountGroup> {
  // SSR-safe default: everything except DEFAULT_LIQUID_EXCLUDED. Real value
  // gets loaded from localStorage in an effect after mount.
  return new Set(allGroups.filter((g) => !DEFAULT_LIQUID_EXCLUDED.includes(g)));
}

function GroupAccordion({
  bucket,
  included,
  onToggle,
}: {
  bucket: GroupBucket;
  included: boolean;
  onToggle: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { items, isLiability, label, total } = bucket;

  return (
    <section>
      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: open ? "8px 8px 0 0" : 8,
          overflow: "hidden",
        }}
      >
        <label
          style={{
            display: "flex",
            alignItems: "center",
            padding: "0 0.85rem",
            borderRight: "1px solid #f1f1f1",
            cursor: "pointer",
            background: included ? "transparent" : "#f9fafb",
          }}
          title={included ? "Included in Net Worth headline" : "Excluded from Net Worth headline"}
        >
          <input
            type="checkbox"
            checked={included}
            onChange={onToggle}
            style={{ accentColor: "#1a1f3a", cursor: "pointer" }}
          />
        </label>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0.85rem 1rem",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: "1rem",
            opacity: included ? 1 : 0.55,
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{
              fontSize: "0.75rem",
              opacity: 0.55,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}>
              {label}
            </span>
            <span style={{ fontSize: "0.8rem", opacity: 0.4 }}>
              {items.length} account{items.length !== 1 ? "s" : ""}
            </span>
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <span data-sensitive style={{
              fontWeight: 600,
              fontVariantNumeric: "tabular-nums",
              color: isLiability ? "#dc2626" : "#16a34a",
            }}>
              {isLiability ? `−${formatMoney(total)}` : formatMoney(total)}
            </span>
            <span style={{
              fontSize: "0.75rem",
              opacity: 0.4,
              transform: open ? "rotate(180deg)" : "none",
              transition: "transform 0.15s",
              display: "inline-block",
            }}>
              ▾
            </span>
          </span>
        </button>
      </div>

      {open && (
        <div style={{
          border: "1px solid #e5e7eb",
          borderTop: "none",
          borderRadius: "0 0 8px 8px",
          overflow: "hidden",
        }}>
          {items.map((b, i) => {
            const displayBalance = b.current ?? 0;
            return (
              <div
                key={b.plaidAccountId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "0.7rem 1rem",
                  background: i % 2 === 0 ? "#fafafa" : "#fff",
                  borderTop: i === 0 ? "none" : "1px solid #f3f4f6",
                }}
              >
                <div>
                  <div style={{ fontWeight: 500, fontSize: "0.975rem" }}>
                    {accountDisplayName(b)}
                  </div>
                  <div style={{ fontSize: "0.8rem", opacity: 0.45, marginTop: "0.1rem" }}>
                    {accountSubtitle(b)}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div data-sensitive style={{
                    fontWeight: 600,
                    fontVariantNumeric: "tabular-nums",
                    color: isLiability ? "#dc2626" : "inherit",
                  }}>
                    {isLiability
                      ? `−${formatMoney(displayBalance)}`
                      : formatMoney(displayBalance)}
                  </div>
                  {b.available != null && b.available !== b.current && (
                    <div style={{ fontSize: "0.775rem", opacity: 0.45, marginTop: "0.1rem" }}>
                      <span data-sensitive>{formatMoney(b.available)}</span> available
                    </div>
                  )}
                  <div style={{ fontSize: "0.725rem", opacity: 0.35, marginTop: "0.1rem" }}>
                    {formatAsOf(b.asOf)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function NetWorthClient({ balances, daily }: Props) {
  const buckets = useMemo(() => buildGroups(balances), [balances]);
  const presentGroups = useMemo(() => buckets.map((b) => b.group), [buckets]);

  const [included, setIncluded] = useState<Set<AccountGroup>>(() => loadIncluded(presentGroups));

  // Hydrate from localStorage post-mount so SSR markup is stable.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;
      const valid = parsed.filter(isAccountGroup) as AccountGroup[];
      setIncluded(new Set(valid));
    } catch {
      // ignore — fall back to default
    }
  }, []);

  function toggleGroup(group: AccountGroup) {
    setIncluded((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      try {
        localStorage.setItem(LS_KEY, JSON.stringify([...next]));
      } catch {
        // ignore
      }
      return next;
    });
  }

  const summary = useMemo(() => {
    let assets = 0;
    let liabilities = 0;
    for (const b of buckets) {
      if (!included.has(b.group)) continue;
      if (b.isLiability) liabilities += b.total;
      else assets += b.total;
    }
    return { assets, liabilities, netWorth: assets - liabilities };
  }, [buckets, included]);

  // Net Cash = cash & checking − credit card balances. Independent of the
  // per-group Include checkboxes — this is "what's on hand right now" and
  // always reflects the full cash + cards picture.
  const netCash = useMemo(() => {
    const cash = buckets.find((b) => b.group === "cash_checking")?.total ?? 0;
    const cards = buckets.find((b) => b.group === "credit_cards")?.total ?? 0;
    const hasEither =
      buckets.some((b) => b.group === "cash_checking") ||
      buckets.some((b) => b.group === "credit_cards");
    return { value: cash - cards, show: hasEither };
  }, [buckets]);

  const hasData = balances.length > 0;
  const excludedPresent = buckets.filter((b) => !included.has(b.group));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

      {/* No data state */}
      {!hasData && (
        <section style={{
          padding: "2rem",
          border: "1px dashed #d1d5db",
          borderRadius: 10,
          textAlign: "center",
          opacity: 0.7,
        }}>
          <p style={{ margin: "0 0 0.5rem", fontWeight: 500 }}>No balance data yet</p>
          <p style={{ margin: 0, fontSize: "0.95rem" }}>
            Hit <strong>Refresh balances</strong> above, or sync a bank on the{" "}
            <a href="/settings/plaid" style={{ textDecoration: "underline" }}>Plaid Import</a> page.
          </p>
        </section>
      )}

      {/* Net Worth hero: big number + delta + chart */}
      {hasData && (
        <NetWorthChart
          daily={daily}
          balances={balances}
          included={included}
          netWorth={summary.netWorth}
        />
      )}

      {/* Assets / Liabilities + Excluded hint */}
      {hasData && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", padding: "0 0.25rem" }}>
          <div
            data-sensitive
            style={{
              fontSize: "1.05rem",
              display: "flex",
              gap: "1.75rem",
              flexWrap: "wrap",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <span>
              Assets:{" "}
              <strong style={{ color: "#16a34a" }}>
                {formatMoney(summary.assets)}
              </strong>
            </span>
            <span>
              Liabilities:{" "}
              <strong style={{ color: "#dc2626" }}>
                −{formatMoney(summary.liabilities)}
              </strong>
            </span>
          </div>
          {excludedPresent.length > 0 && (
            <div style={{ fontSize: "0.8rem", opacity: 0.55 }}>
              Excluded: {excludedPresent.map((b) => b.label).join(", ")}
            </div>
          )}
        </div>
      )}

      {/* Net Cash strip — cash & checking minus credit cards */}
      {hasData && netCash.show && (
        <section
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            padding: "0.85rem 1rem",
          }}
          title="Cash & Checking balances minus Credit Card balances — what you have on hand."
        >
          <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span
              style={{
                fontSize: "0.75rem",
                opacity: 0.55,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              Net Cash
            </span>
            <span style={{ fontSize: "0.8rem", opacity: 0.4 }}>
              cash & checking − cards
            </span>
          </span>
          <span
            data-sensitive
            style={{
              fontWeight: 600,
              fontVariantNumeric: "tabular-nums",
              color: netCash.value >= 0 ? "#16a34a" : "#dc2626",
            }}
          >
            {netCash.value >= 0
              ? formatMoney(netCash.value)
              : `−${formatMoney(Math.abs(netCash.value))}`}
          </span>
        </section>
      )}

      {/* Per-group accordions with include/exclude toggles */}
      {buckets.map((bucket) => (
        <GroupAccordion
          key={bucket.group}
          bucket={bucket}
          included={included.has(bucket.group)}
          onToggle={() => toggleGroup(bucket.group)}
        />
      ))}
    </div>
  );
}
