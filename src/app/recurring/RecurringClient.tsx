"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { formatMoney } from "../../lib/format.ts";
import {
  dismissRecurringMerchant,
  undismissRecurringMerchant,
} from "../../lib/actions.ts";
import type { RecurringGroup } from "../../lib/recurring.ts";

const CADENCE_LABEL: Record<RecurringGroup["cadence"], string> = {
  weekly: "Weekly",
  biweekly: "Biweekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annual",
  irregular: "Irregular",
};

const CADENCE_OPTIONS = ["weekly", "biweekly", "monthly", "quarterly", "annual"] as const;

function fmtShortDate(yyyymmdd: string): string {
  const d = new Date(yyyymmdd + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function subLabel(g: RecurringGroup): string {
  const kind = g.amountVariance === "variable" ? "Bill" : "Subscription";
  const variesNote =
    g.amountVariance === "variable"
      ? ` · varies ${formatMoney(g.minAmount)}–${formatMoney(g.maxAmount)}`
      : "";
  return `${kind} · ${g.occurrenceCount} charge${g.occurrenceCount !== 1 ? "s" : ""}${variesNote}`;
}

export default function RecurringClient(props: {
  groups: RecurringGroup[];
  profileParam: string | undefined;
  initialStatus: string;
  initialCadence: string;
  initialVariance: string;
  initialSort: string;
  initialQuery: string;
  initialShowDismissed: boolean;
  minOccurrences: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [status, setStatus] = useState(props.initialStatus);
  const [cadenceFilter, setCadenceFilter] = useState(props.initialCadence);
  const [variance, setVariance] = useState(props.initialVariance);
  const [sort, setSort] = useState(props.initialSort);
  const [query, setQuery] = useState(props.initialQuery);
  const [showDismissed, setShowDismissed] = useState(props.initialShowDismissed);
  const profileSuffix = props.profileParam ? `?profile=${encodeURIComponent(props.profileParam)}` : "";

  // Push minOccurrences changes through URL (re-runs server).
  function setMinOccurrences(n: number) {
    const next = new URLSearchParams(sp.toString());
    next.set("minOccurrences", String(n));
    router.push(`${pathname}?${next.toString()}`);
  }

  const filtered = useMemo(() => {
    const cadences = cadenceFilter ? new Set(cadenceFilter.split(",")) : null;
    const q = query.trim().toLowerCase();
    const list = props.groups.filter((g) => {
      if (!showDismissed && g.dismissed) return false;
      if (status !== "all" && g.status !== status) return false;
      if (cadences && !cadences.has(g.cadence)) return false;
      if (variance !== "all" && g.amountVariance !== variance) return false;
      if (q && !g.merchant.toLowerCase().includes(q)) return false;
      return true;
    });
    list.sort((a, b) => {
      if (sort === "lastdate") return b.lastDate.localeCompare(a.lastDate);
      if (sort === "name") return a.merchant.localeCompare(b.merchant);
      if (sort === "count") return b.occurrenceCount - a.occurrenceCount;
      // monthly (default): by absolute monthly $ impact
      return Math.abs(b.monthlyEquivalent) - Math.abs(a.monthlyEquivalent);
    });
    return list;
  }, [props.groups, status, cadenceFilter, variance, query, sort, showDismissed]);

  // Stats for the header (excluding dismissed regardless of toggle).
  const visibleForStats = props.groups.filter((g) => !g.dismissed && g.status === "active");
  const subCount = visibleForStats.filter((g) => g.amountVariance !== "variable").length;
  const billCount = visibleForStats.filter((g) => g.amountVariance === "variable").length;
  const committedMonthly = visibleForStats.reduce((s, g) => s + Math.abs(g.monthlyEquivalent), 0);

  function handleDismiss(merchant: string) {
    startTransition(async () => {
      await dismissRecurringMerchant(merchant);
      router.refresh();
    });
  }
  function handleRestore(merchant: string) {
    startTransition(async () => {
      await undismissRecurringMerchant(merchant);
      router.refresh();
    });
  }

  return (
    <main style={{ padding: "1.5rem 2rem", maxWidth: 1100, margin: "0 auto", width: "100%" }}>
      <h1 style={{ fontSize: "1.75rem", fontWeight: 700, margin: "0 0 0.25rem" }}>Recurring</h1>
      <div style={{ fontSize: "0.95rem", opacity: 0.75, marginBottom: "1.25rem" }}>
        {subCount} active subscription{subCount !== 1 ? "s" : ""} · {billCount} active bill
        {billCount !== 1 ? "s" : ""} · <span data-sensitive>{formatMoney(committedMonthly)}</span>/month committed
      </div>

      {/* Sticky filter bar */}
      <div
        style={{
          position: "sticky",
          top: 54,
          background: "#fff",
          padding: "0.75rem 0",
          borderBottom: "1px solid #eee",
          display: "flex",
          flexWrap: "wrap",
          gap: "0.5rem 0.75rem",
          alignItems: "center",
          zIndex: 5,
        }}
      >
        {/* Status pills */}
        <div style={{ display: "inline-flex", gap: 4 }}>
          {(["all", "active", "lapsed", "ended"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              style={pillStyle(status === s)}
            >
              {s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        {/* Cadence multi-select-as-dropdown */}
        <select
          value={cadenceFilter || "all"}
          onChange={(e) => setCadenceFilter(e.target.value === "all" ? "" : e.target.value)}
          style={selectStyle}
        >
          <option value="all">Any cadence</option>
          {CADENCE_OPTIONS.map((c) => (
            <option key={c} value={c}>
              {CADENCE_LABEL[c]}
            </option>
          ))}
        </select>

        <select value={variance} onChange={(e) => setVariance(e.target.value)} style={selectStyle}>
          <option value="all">Subscriptions + Bills</option>
          <option value="fixed">Fixed only</option>
          <option value="near-fixed">Near-fixed only</option>
          <option value="variable">Variable (Bills) only</option>
        </select>

        <label style={{ fontSize: "0.85rem", opacity: 0.7 }}>
          Min occurrences:{" "}
          <select
            value={props.minOccurrences}
            onChange={(e) => setMinOccurrences(Number(e.target.value))}
            style={selectStyle}
          >
            {[2, 3, 4, 6].map((n) => (
              <option key={n} value={n}>
                ≥{n}
              </option>
            ))}
          </select>
        </label>

        <select value={sort} onChange={(e) => setSort(e.target.value)} style={selectStyle}>
          <option value="monthly">Sort: $/month</option>
          <option value="lastdate">Sort: most recent</option>
          <option value="name">Sort: name</option>
          <option value="count">Sort: # charges</option>
        </select>

        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search merchant…"
          style={{
            flex: "1 1 180px",
            minWidth: 160,
            padding: "0.35rem 0.55rem",
            border: "1px solid #ccc",
            borderRadius: 4,
            fontSize: "0.9rem",
          }}
        />

        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.85rem", opacity: 0.75 }}>
          <input
            type="checkbox"
            checked={showDismissed}
            onChange={(e) => setShowDismissed(e.target.checked)}
          />
          Show dismissed
        </label>
      </div>

      {filtered.length === 0 ? (
        <p style={{ marginTop: "2rem", opacity: 0.6 }}>
          No recurring charges match these filters. Try widening the date range or lowering Min occurrences.
        </p>
      ) : (
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            marginTop: "1rem",
            fontSize: "0.92rem",
            tableLayout: "fixed",
          }}
        >
          <colgroup>
            <col style={{ width: "28%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "8%" }} />
          </colgroup>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd", color: "#666" }}>
              <th style={th}>Merchant</th>
              <th style={th}>Cadence</th>
              <th style={th}>Last</th>
              <th style={th}>Next</th>
              <th style={{ ...th, textAlign: "right" }}>Last paid</th>
              <th style={{ ...th, textAlign: "right" }}>Avg</th>
              <th style={{ ...th, textAlign: "right" }}>/mo</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((g) => {
              const dim = g.status !== "active" || g.dismissed;
              return (
                <tr
                  key={g.merchant}
                  style={{ borderBottom: "1px solid #f0f0f0", opacity: g.dismissed ? 0.5 : dim ? 0.6 : 1 }}
                >
                  <td style={td}>
                    <Link
                      href={`/merchants/${encodeURIComponent(g.merchant)}${profileSuffix}`}
                      data-sensitive
                      style={{ color: "#2563eb", textDecoration: "none", fontWeight: 500 }}
                    >
                      {g.merchant}
                    </Link>
                    <div style={{ fontSize: "0.78rem", opacity: 0.65 }}>{subLabel(g)}</div>
                  </td>
                  <td style={td}>{CADENCE_LABEL[g.cadence]}</td>
                  <td style={td}>{fmtShortDate(g.lastDate)}</td>
                  <td style={td}>
                    {g.status === "ended" ? "—" : g.status === "lapsed" ? "Lapsed" : fmtShortDate(g.expectedNextDate)}
                  </td>
                  <td style={{ ...td, textAlign: "right" }}>
                    <span data-sensitive>{formatMoney(Math.abs(g.lastAmount))}</span>
                  </td>
                  <td style={{ ...td, textAlign: "right" }}>
                    <span data-sensitive>{formatMoney(Math.abs(g.meanAmount))}</span>
                  </td>
                  <td style={{ ...td, textAlign: "right" }}>
                    {g.status === "active" ? (
                      <span data-sensitive>{formatMoney(Math.abs(g.monthlyEquivalent))}</span>
                    ) : (
                      <span style={{ opacity: 0.5 }}>—</span>
                    )}
                  </td>
                  <td style={{ ...td, textAlign: "right" }}>
                    {g.dismissed ? (
                      <button
                        disabled={isPending}
                        onClick={() => handleRestore(g.merchant)}
                        style={smallBtn}
                      >
                        Restore
                      </button>
                    ) : (
                      <button
                        disabled={isPending}
                        onClick={() => handleDismiss(g.merchant)}
                        style={smallBtn}
                        title="Hide this merchant from recurring view"
                      >
                        Dismiss
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}

const th: React.CSSProperties = {
  padding: "0.5rem 0.5rem",
  fontWeight: 600,
  fontSize: "0.78rem",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};
const td: React.CSSProperties = {
  padding: "0.6rem 0.5rem",
  verticalAlign: "top",
};
const selectStyle: React.CSSProperties = {
  padding: "0.3rem 0.45rem",
  border: "1px solid #ccc",
  borderRadius: 4,
  fontSize: "0.85rem",
  background: "#fff",
};
const smallBtn: React.CSSProperties = {
  padding: "0.25rem 0.6rem",
  fontSize: "0.78rem",
  background: "#fff",
  border: "1px solid #ccc",
  borderRadius: 4,
  cursor: "pointer",
};
function pillStyle(active: boolean): React.CSSProperties {
  return {
    padding: "0.3rem 0.7rem",
    border: "1px solid",
    borderColor: active ? "#2563eb" : "#ccc",
    background: active ? "#2563eb" : "#fff",
    color: active ? "#fff" : "#333",
    borderRadius: 999,
    fontSize: "0.82rem",
    cursor: "pointer",
  };
}
