"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { CATEGORY_ICONS } from "@/lib/categoryIcons.ts";
import { ACCOUNT_GROUPS, ACCOUNT_GROUP_LABELS, type AccountGroup } from "@/lib/accountGroups.ts";

type CategoryClassification = "expense" | "income" | "ignored";

interface CategoryMeta {
  name: string;
  icon?: string | null;
  color?: string | null;
  classification?: CategoryClassification | null;
}

const CLASSIFICATION_ORDER: CategoryClassification[] = ["expense", "income", "ignored"];
const CLASSIFICATION_LABELS: Record<CategoryClassification, string> = {
  expense: "Expense",
  income: "Income",
  ignored: "Ignored",
};

interface AccountOption {
  id: string;
  label: string;
  // Optional. When both are provided across all accounts AND `profiles` is
  // supplied, the Accounts dropdown groups by Profile → AccountGroup.
  // Otherwise it renders flat (legacy behavior for /merchants etc).
  profileId?: string;
  accountGroup?: AccountGroup | null;
}

interface Props {
  accounts: AccountOption[];
  tags: { id: string; displayName: string }[];
  categories: CategoryMeta[];
  searchPlaceholder?: string;
  profiles?: { id: string; displayName: string }[];
  // Earliest / latest aggregation date across the current filtered set. Shown
  // as a subline under the date row so "All Time" isn't an opaque label.
  dataMinDate?: string | null;
  dataMaxDate?: string | null;
  /**
   * The default value of the "Excluded" dropdown when the URL has no `excluded`
   * param — driven by the global "hide excluded by default" preference. The bar
   * omits the param at this value (so it round-trips as the default) and treats
   * a non-default value as an active filter. Defaults to "all".
   */
  defaultExcluded?: "all" | "hide";
  /**
   * When true, this page defaults a bare URL to a recent date window (server-
   * side), so "no date param" is NOT All Time here. The "All Time" pill then
   * writes an explicit `?dates=all` sentinel so it stays reachable. Off by
   * default → the legacy behavior (no date param = All Time), which the
   * category/merchant detail pages rely on.
   */
  allTimeSentinel?: boolean;
}

function parseCsv(v: string | null): string[] {
  if (!v) return [];
  return v.split(",").map((x) => x.trim()).filter(Boolean);
}

function toYMD(d: Date): string {
  return d.toISOString().split("T")[0];
}

function computeDatePresets() {
  const now = new Date();
  const today = toYMD(now);

  const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastOfLastMonth = new Date(firstOfThisMonth);
  lastOfLastMonth.setDate(0);
  const firstOfLastMonth = new Date(lastOfLastMonth.getFullYear(), lastOfLastMonth.getMonth(), 1);

  const d30 = new Date(now);
  d30.setDate(d30.getDate() - 30);
  const d90 = new Date(now);
  d90.setDate(d90.getDate() - 90);

  return [
    { label: "This Month", from: toYMD(firstOfThisMonth), to: today },
    { label: "Last Month", from: toYMD(firstOfLastMonth), to: toYMD(lastOfLastMonth) },
    { label: "Last 30 Days", from: toYMD(d30), to: today },
    { label: "Last 90 Days", from: toYMD(d90), to: today },
    { label: "This Year", from: `${now.getFullYear()}-01-01`, to: today },
    { label: "All Time", from: "", to: "" },
  ] as const;
}

export function TransactionFiltersBar({ accounts, tags, categories, searchPlaceholder, profiles, dataMinDate, dataMaxDate, defaultExcluded = "all", allTimeSentinel = false }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const urlQ = searchParams.get("q") ?? "";
  const urlTags = useMemo(() => new Set(parseCsv(searchParams.get("tags"))), [searchParams]);
  const urlAccounts = useMemo(
    () => new Set(parseCsv(searchParams.get("accounts"))),
    [searchParams],
  );
  const urlCategories = useMemo(
    () => new Set(parseCsv(searchParams.get("categories"))),
    [searchParams],
  );
  const urlFrom = searchParams.get("from") ?? "";
  const urlTo = searchParams.get("to") ?? "";
  // Sentinel-mode only: explicit "no date restriction" marker so All Time is
  // distinguishable from the bare-URL default (which the server fills with a
  // recent window).
  const urlDatesAll = allTimeSentinel && searchParams.get("dates") === "all";
  const urlExcluded = (searchParams.get("excluded") ?? defaultExcluded) as "all" | "hide" | "only";
  const urlOneTime = (searchParams.get("oneTime") ?? "all") as "all" | "hide" | "only";
  const urlCanonical = (searchParams.get("canonical") ?? "all") as "all" | "missing" | "present";
  const urlSource = (searchParams.get("source") ?? "all") as "all" | "csv" | "plaid" | "manual";
  const urlNetExcluded = searchParams.get("netExcluded") === "1";
  const urlProfile = searchParams.get("profile") ?? "";
  const urlAmountOp = (searchParams.get("amountOp") ?? "") as
    | "" | "gt" | "lt" | "eq" | "between";
  const urlAmountVal = searchParams.get("amountVal") ?? "";
  const urlAmountMax = searchParams.get("amountMax") ?? "";

  const [q, setQ] = useState(urlQ);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [openSections, setOpenSections] = useState<Set<string>>(() => {
    const s = new Set<string>();
    if (urlTags.size > 0) s.add("tags");
    if (urlAccounts.size > 0) s.add("accounts");
    if (urlCategories.size > 0) s.add("categories");
    return s;
  });

  const datePresets = useMemo(() => computeDatePresets(), []);

  function pushParams(mutate: (p: URLSearchParams) => void) {
    const next = new URLSearchParams(searchParams.toString());
    mutate(next);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  function setParam(key: string, value: string | undefined) {
    pushParams((p) => {
      if (value && value.length > 0) p.set(key, value);
      else p.delete(key);
      p.delete("page");
    });
  }

  function setDateRange(from: string, to: string) {
    pushParams((p) => {
      if (from) p.set("from", from);
      else p.delete("from");
      if (to) p.set("to", to);
      else p.delete("to");
      // Any explicit range supersedes the All-Time sentinel.
      p.delete("dates");
      p.delete("page");
    });
  }

  // Click handler for a date preset pill. In sentinel mode the All Time pill
  // writes `?dates=all` (instead of clearing to bare, which the server would
  // re-fill with the recent default).
  function onPresetClick(preset: { label: string; from: string; to: string }) {
    const isAllTime = preset.from === "" && preset.to === "";
    if (isAllTime && allTimeSentinel) {
      if (urlDatesAll) {
        // toggle the sentinel off → bare → server reasserts the recent default
        setDateRange("", "");
      } else {
        pushParams((p) => {
          p.set("dates", "all");
          p.delete("from");
          p.delete("to");
          p.delete("page");
        });
      }
      return;
    }
    if (activePreset?.label === preset.label) setDateRange("", "");
    else setDateRange(preset.from, preset.to);
  }

  function toggleInSet(key: string, current: Set<string>, value: string) {
    const next = new Set(current);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setParam(key, Array.from(next).join(","));
  }

  function replaceSet(key: string, current: Set<string>, values: string[]) {
    const next = new Set(current);
    const allPresent = values.every((v) => next.has(v));
    if (allPresent) {
      for (const v of values) next.delete(v);
    } else {
      for (const v of values) next.add(v);
    }
    setParam(key, Array.from(next).join(","));
  }

  function onSearchChange(value: string) {
    setQ(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setParam("q", value || undefined);
    }, 200);
  }

  function clearAll() {
    setQ("");
    // Preserve profile selection — it's a session-level setting, not a filter.
    const profile = searchParams.get("profile");
    if (profile) {
      router.replace(`${pathname}?profile=${encodeURIComponent(profile)}`);
    } else {
      router.replace(pathname);
    }
  }

  function toggleSection(key: string) {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // "All Time" (from="" / to="") lights up when no date filter is set; other
  // presets light up on their exact range. In sentinel mode the explicit
  // `?dates=all` marker lights up All Time even when a default range was
  // stripped from the URL, and the bare-URL default (Last 30 Days) is NOT
  // counted as an active filter (otherwise "Clear all" would always show).
  const last30Preset = datePresets.find((p) => p.label === "Last 30 Days") ?? null;
  const allTimePreset = datePresets.find((p) => p.from === "" && p.to === "") ?? null;
  const activePreset = urlDatesAll
    ? allTimePreset
    : (datePresets.find((p) => p.from === urlFrom && p.to === urlTo) ?? null);
  const dateIsDefaultRecent =
    allTimeSentinel && !urlDatesAll && last30Preset != null &&
    urlFrom === last30Preset.from && urlTo === last30Preset.to;
  const dateActive = urlDatesAll || (!!(urlFrom || urlTo) && !dateIsDefaultRecent);

  const hasAny =
    urlQ ||
    urlTags.size > 0 ||
    urlAccounts.size > 0 ||
    urlCategories.size > 0 ||
    dateActive ||
    urlExcluded !== defaultExcluded ||
    urlOneTime !== "all" ||
    urlCanonical !== "all" ||
    urlSource !== "all" ||
    urlAmountOp !== "";

  function setAmountFilter(op: typeof urlAmountOp, val?: string, max?: string) {
    pushParams((p) => {
      if (op) p.set("amountOp", op);
      else p.delete("amountOp");
      if (val && val.length > 0) p.set("amountVal", val);
      else p.delete("amountVal");
      if (max && max.length > 0) p.set("amountMax", max);
      else p.delete("amountMax");
      p.delete("page");
    });
  }

  const amountNeedsValue = urlAmountOp !== "";
  const amountNeedsMax = urlAmountOp === "between";

  const amountIsPositive = urlAmountOp === "gt" && urlAmountVal === "0";
  const amountIsNegative = urlAmountOp === "lt" && urlAmountVal === "0";

  return (
    <div
      style={{
        border: "1px solid #ddd",
        borderRadius: 6,
        padding: "0.75rem 1rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.6rem",
        fontSize: "0.975rem",
      }}
    >
      {/* Row 1: search + clear all */}
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <input
          type="text"
          placeholder={searchPlaceholder ?? "Search name, description, category, note…"}
          value={q}
          onChange={(e) => onSearchChange(e.target.value)}
          style={{
            flex: 1,
            padding: "0.4rem 0.6rem",
            border: "1px solid #ccc",
            borderRadius: 4,
            fontSize: "1.025rem",
          }}
        />
        {hasAny ? (
          <button
            type="button"
            onClick={clearAll}
            style={{
              padding: "0.35rem 0.7rem",
              border: "1px solid #ccc",
              borderRadius: 4,
              background: "transparent",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            Clear all
          </button>
        ) : null}
      </div>

      {/* Row 2: date — quick pills + from/to */}
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
        {datePresets.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => onPresetClick(p)}
            style={{
              padding: "0.2rem 0.65rem",
              borderRadius: 999,
              fontSize: "0.905rem",
              border: `1px solid ${activePreset?.label === p.label ? "#2a5db0" : "#bbb"}`,
              background: activePreset?.label === p.label ? "#2a5db0" : "transparent",
              color: activePreset?.label === p.label ? "white" : "inherit",
              cursor: "pointer",
            }}
          >
            {p.label}
          </button>
        ))}

        <span style={{ opacity: 0.3, userSelect: "none" }}>|</span>

        <DateRangeInputs
          urlFrom={urlFrom}
          urlTo={urlTo}
          dataMinDate={dataMinDate}
          dataMaxDate={dataMaxDate}
          onCommit={(from, to) => setDateRange(from, to)}
        />
      </div>

      {/* Collapsible chip rows */}
      {tags.length > 0 ? (
        <CollapsibleSection
          label="Tags"
          activeCount={urlTags.size}
          open={openSections.has("tags")}
          onToggle={() => toggleSection("tags")}
        >
          {tags.map((t) => (
            <Chip
              key={t.id}
              active={urlTags.has(t.id)}
              onClick={() => toggleInSet("tags", urlTags, t.id)}
            >
              {t.displayName}
            </Chip>
          ))}
        </CollapsibleSection>
      ) : null}

      {(() => {
        // When a profile is active in the URL, narrow accounts to that profile.
        // "all" or empty = show all. Falls back to all accounts if no profileId
        // data is on the rows (legacy callers).
        const scopedAccounts =
          urlProfile && urlProfile !== "all"
            ? accounts.filter((a) => a.profileId == null || a.profileId === urlProfile)
            : accounts;
        return scopedAccounts.length > 0 ? (
          <CollapsibleSection
            label="Accounts"
            activeCount={urlAccounts.size}
            open={openSections.has("accounts")}
            onToggle={() => toggleSection("accounts")}
          >
            <AccountChips
              accounts={scopedAccounts}
              profiles={profiles}
              selected={urlAccounts}
              onToggle={(id) => toggleInSet("accounts", urlAccounts, id)}
            />
          </CollapsibleSection>
        ) : null;
      })()}

      {categories.length > 0 ? (
        <CollapsibleSection
          label="Categories"
          activeCount={urlCategories.size}
          open={openSections.has("categories")}
          onToggle={() => toggleSection("categories")}
        >
          <CategoryChips
            categories={categories}
            selected={urlCategories}
            onToggle={(name) => toggleInSet("categories", urlCategories, name)}
            onToggleBucket={(names) => replaceSet("categories", urlCategories, names)}
          />
        </CollapsibleSection>
      ) : null}

      {/* Row: status dropdowns + totals toggle */}
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
        <select
          value={urlExcluded}
          onChange={(e) =>
            setParam("excluded", e.target.value === defaultExcluded ? undefined : e.target.value)
          }
          style={statusSelectStyle}
        >
          <option value="all">Excluded: All</option>
          <option value="hide">Excluded: Hide</option>
          <option value="only">Excluded: Only</option>
        </select>

        <select
          value={urlOneTime}
          onChange={(e) =>
            setParam("oneTime", e.target.value === "all" ? undefined : e.target.value)
          }
          style={statusSelectStyle}
        >
          <option value="all">One-time: All</option>
          <option value="hide">One-time: Hide</option>
          <option value="only">One-time: Only</option>
        </select>

        <select
          value={urlCanonical}
          onChange={(e) =>
            setParam("canonical", e.target.value === "all" ? undefined : e.target.value)
          }
          title="Filter by whether a transaction has a canonical merchant name set (i.e. has been reconciled)"
          style={statusSelectStyle}
        >
          <option value="all">Reconciled: All</option>
          <option value="missing">Unreconciled only</option>
          <option value="present">Reconciled only</option>
        </select>

        <select
          value={urlSource}
          onChange={(e) =>
            setParam("source", e.target.value === "all" ? undefined : e.target.value)
          }
          title="Filter by where the transaction came from"
          style={statusSelectStyle}
        >
          <option value="all">Source: All</option>
          <option value="plaid">Plaid</option>
          <option value="csv">CSV</option>
          <option value="manual">Manual</option>
        </select>

        <label style={{ display: "flex", gap: "0.35rem", alignItems: "center", fontSize: "0.925rem", cursor: "pointer", userSelect: "none" }}>
          <input
            type="checkbox"
            checked={urlNetExcluded}
            onChange={(e) => setParam("netExcluded", e.target.checked ? "1" : undefined)}
          />
          Include excluded in totals
        </label>
      </div>

      {/* Row: amount filter */}
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ opacity: 0.7, fontSize: "0.925rem" }}>Amount</span>
        <button
          type="button"
          onClick={() =>
            amountIsPositive ? setAmountFilter("", "", "") : setAmountFilter("gt", "0", "")
          }
          style={{
            padding: "0.2rem 0.65rem",
            borderRadius: 999,
            fontSize: "0.905rem",
            border: `1px solid ${amountIsPositive ? "#2a5db0" : "#bbb"}`,
            background: amountIsPositive ? "#2a5db0" : "transparent",
            color: amountIsPositive ? "white" : "inherit",
            cursor: "pointer",
          }}
        >
          Positive
        </button>
        <button
          type="button"
          onClick={() =>
            amountIsNegative ? setAmountFilter("", "", "") : setAmountFilter("lt", "0", "")
          }
          style={{
            padding: "0.2rem 0.65rem",
            borderRadius: 999,
            fontSize: "0.905rem",
            border: `1px solid ${amountIsNegative ? "#2a5db0" : "#bbb"}`,
            background: amountIsNegative ? "#2a5db0" : "transparent",
            color: amountIsNegative ? "white" : "inherit",
            cursor: "pointer",
          }}
        >
          Negative
        </button>
        <span style={{ opacity: 0.3, userSelect: "none" }}>|</span>
        <select
          value={urlAmountOp}
          onChange={(e) => {
            const next = e.target.value as typeof urlAmountOp;
            if (!next) setAmountFilter("", "", "");
            else setAmountFilter(next, urlAmountVal, next === "between" ? urlAmountMax : "");
          }}
          style={statusSelectStyle}
        >
          <option value="">Any</option>
          <option value="gt">is more than</option>
          <option value="lt">is less than</option>
          <option value="eq">equals</option>
          <option value="between">is between</option>
        </select>
        {amountNeedsValue && (
          <AmountInput
            key={`amountVal:${urlAmountOp}|${urlAmountVal}`}
            initial={urlAmountVal}
            placeholder={amountNeedsMax ? "min ($, signed)" : "$ (signed: -50 = expense)"}
            onCommit={(v) => setAmountFilter(urlAmountOp, v, urlAmountMax)}
          />
        )}
        {amountNeedsMax && (
          <>
            <span style={{ opacity: 0.6 }}>and</span>
            <AmountInput
              key={`amountMax:${urlAmountOp}|${urlAmountMax}`}
              initial={urlAmountMax}
              placeholder="max ($, signed)"
              onCommit={(v) => setAmountFilter(urlAmountOp, urlAmountVal, v)}
            />
          </>
        )}
      </div>
    </div>
  );
}

// Uncontrolled date inputs. type="date" inputs have three independent subfields
// (mm/dd/yyyy in most locales) and the .value only becomes a complete YYYY-MM-DD
// string once all three are filled — partial states report as "". Making the
// inputs controlled means React keeps overwriting the user's in-progress typing
// with empty, which is why tabbing between subfields appeared to revert the
// value. We let the browser fully own intermediate state and read input.value
// only when the user commits (blur or Enter). `key` is bumped whenever the URL
// changes externally (preset pills, Clear all) so React re-mounts the input
// with a fresh defaultValue.
function DateRangeInputs({
  urlFrom,
  urlTo,
  dataMinDate,
  dataMaxDate,
  onCommit,
}: {
  urlFrom: string;
  urlTo: string;
  dataMinDate?: string | null;
  dataMaxDate?: string | null;
  onCommit: (from: string, to: string) => void;
}) {
  const fromRef = useRef<HTMLInputElement | null>(null);
  const toRef = useRef<HTMLInputElement | null>(null);

  const fromDefault = urlFrom || dataMinDate || "";
  const toDefault = urlTo || dataMaxDate || "";

  // YYYY-MM-DD, year between 1900 and 2999 — guards against partial typing
  // (e.g. "0026" while typing "2026") from pushing a nonsense filter.
  function isCommittable(v: string): boolean {
    if (v === "") return true;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    const y = Number(v.slice(0, 4));
    return y >= 1900 && y <= 2999;
  }

  function commitFromInputs() {
    const fromVal = fromRef.current?.value ?? "";
    const toVal = toRef.current?.value ?? "";
    if (!isCommittable(fromVal) || !isCommittable(toVal)) return;
    if (fromVal !== urlFrom || toVal !== urlTo) onCommit(fromVal, toVal);
  }

  return (
    <>
      <label style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}>
        From
        <input
          key={`from:${urlFrom}|${dataMinDate ?? ""}`}
          ref={fromRef}
          type="date"
          defaultValue={fromDefault}
          onBlur={commitFromInputs}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitFromInputs();
          }}
          style={{
            padding: "0.3rem",
            border: "1px solid #ccc",
            borderRadius: 4,
            opacity: urlFrom ? 1 : 0.65,
          }}
        />
      </label>
      <label style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}>
        To
        <input
          key={`to:${urlTo}|${dataMaxDate ?? ""}`}
          ref={toRef}
          type="date"
          defaultValue={toDefault}
          onBlur={commitFromInputs}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitFromInputs();
          }}
          style={{
            padding: "0.3rem",
            border: "1px solid #ccc",
            borderRadius: 4,
            opacity: urlTo ? 1 : 0.65,
          }}
        />
      </label>
    </>
  );
}

// Uncontrolled number input — same reasoning as DateRangeInputs. A controlled
// `value={urlAmountVal}` + onChange-to-URL pushes a re-render every keystroke,
// which fights typing of multi-digit / decimal values (especially the leading
// "-" of a signed amount). We let the browser own intermediate state and only
// commit on blur or Enter. `key` is bumped externally when the URL changes
// (e.g. operator dropdown clears the value).
function AmountInput({
  initial,
  placeholder,
  onCommit,
}: {
  initial: string;
  placeholder: string;
  onCommit: (value: string) => void;
}) {
  const ref = useRef<HTMLInputElement | null>(null);

  function commit() {
    const raw = ref.current?.value ?? "";
    const trimmed = raw.trim();
    if (trimmed === "") {
      if (initial !== "") onCommit("");
      return;
    }
    // Reject anything that isn't a finite number — partial typing like "-"
    // or "1." would otherwise round-trip and surprise the user.
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return;
    if (trimmed !== initial) onCommit(trimmed);
  }

  return (
    <input
      ref={ref}
      type="number"
      step="0.01"
      defaultValue={initial}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
      }}
      placeholder={placeholder}
      style={{ ...statusSelectStyle, width: 180 }}
    />
  );
}

const statusSelectStyle: React.CSSProperties = {
  padding: "0.35rem 0.5rem",
  border: "1px solid #ccc",
  borderRadius: 4,
  fontSize: "0.975rem",
};

function CollapsibleSection({
  label,
  activeCount,
  open,
  onToggle,
  children,
}: {
  label: string;
  activeCount: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.35rem",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "0.15rem 0",
          fontSize: "0.975rem",
          color: "inherit",
          opacity: 0.7,
        }}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {label}
        {activeCount > 0 && !open ? (
          <span
            style={{
              background: "#2a5db0",
              color: "white",
              borderRadius: 999,
              padding: "0 0.45rem",
              fontSize: "0.8rem",
              lineHeight: "1.5",
            }}
          >
            {activeCount}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          style={{
            display: "flex",
            gap: "0.35rem",
            flexWrap: "wrap",
            paddingTop: "0.3rem",
            paddingLeft: "1.2rem",
          }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

function AccountChips({
  accounts,
  profiles,
  selected,
  onToggle,
}: {
  accounts: AccountOption[];
  profiles?: { id: string; displayName: string }[];
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  // Group when we have both profile data on every account and a profiles list.
  const canGroup =
    profiles != null &&
    profiles.length > 0 &&
    accounts.every((a) => a.profileId != null);

  if (!canGroup) {
    return (
      <>
        {accounts.map((a) => (
          <Chip key={a.id} active={selected.has(a.id)} onClick={() => onToggle(a.id)}>
            {a.label}
          </Chip>
        ))}
      </>
    );
  }

  const profileLabelById = new Map(profiles!.map((p) => [p.id, p.displayName]));
  const byProfile = new Map<string, AccountOption[]>();
  for (const a of accounts) {
    const key = a.profileId!;
    if (!byProfile.has(key)) byProfile.set(key, []);
    byProfile.get(key)!.push(a);
  }

  // Render profiles in the order they appear in the `profiles` prop, then any
  // others (shouldn't happen but safe).
  const orderedProfileIds = [
    ...profiles!.map((p) => p.id).filter((id) => byProfile.has(id)),
    ...Array.from(byProfile.keys()).filter((id) => !profileLabelById.has(id)),
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", width: "100%" }}>
      {orderedProfileIds.map((pid) => {
        const profileAccounts = byProfile.get(pid)!;
        const byGroup = new Map<string, AccountOption[]>();
        for (const a of profileAccounts) {
          const key = a.accountGroup ?? "other";
          if (!byGroup.has(key)) byGroup.set(key, []);
          byGroup.get(key)!.push(a);
        }
        const orderedGroupKeys = [
          ...ACCOUNT_GROUPS.filter((g) => byGroup.has(g)),
          ...Array.from(byGroup.keys()).filter(
            (g) => !(ACCOUNT_GROUPS as readonly string[]).includes(g),
          ),
        ];
        return (
          <div key={pid} style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
            <div style={{ fontSize: "0.875rem", fontWeight: 600, opacity: 0.75 }}>
              {profileLabelById.get(pid) ?? pid}
            </div>
            {orderedGroupKeys.map((gKey) => {
              const groupAccounts = byGroup.get(gKey)!;
              const label = (ACCOUNT_GROUP_LABELS as Record<string, string>)[gKey] ?? gKey;
              return (
                <div
                  key={gKey}
                  style={{ display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap", paddingLeft: "0.75rem" }}
                >
                  <span style={{ fontSize: "0.825rem", opacity: 0.6, minWidth: 110 }}>{label}</span>
                  {groupAccounts.map((a) => (
                    <Chip
                      key={a.id}
                      active={selected.has(a.id)}
                      onClick={() => onToggle(a.id)}
                    >
                      {a.label}
                    </Chip>
                  ))}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function CategoryChips({
  categories,
  selected,
  onToggle,
  onToggleBucket,
}: {
  categories: CategoryMeta[];
  selected: Set<string>;
  onToggle: (name: string) => void;
  onToggleBucket: (names: string[]) => void;
}) {
  const byClass = new Map<CategoryClassification, CategoryMeta[]>();
  for (const c of categories) {
    const key: CategoryClassification = c.classification ?? "expense";
    if (!byClass.has(key)) byClass.set(key, []);
    byClass.get(key)!.push(c);
  }
  const orderedKeys = CLASSIFICATION_ORDER.filter((k) => byClass.has(k));

  // Single bucket → render flat (no subheader noise).
  if (orderedKeys.length <= 1) {
    return (
      <>
        {categories.map((c) => {
          const IconComp = CATEGORY_ICONS[c.icon || "Circle"] || CATEGORY_ICONS["Circle"];
          const active = selected.has(c.name);
          return (
            <Chip key={c.name} active={active} onClick={() => onToggle(c.name)}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
                <IconComp size={12} color={active ? "white" : (c.color || "#888")} />
                {c.name}
              </span>
            </Chip>
          );
        })}
      </>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", width: "100%" }}>
      {orderedKeys.map((cls) => {
        const bucketNames = byClass.get(cls)!.map((c) => c.name);
        const allSelected = bucketNames.length > 0 && bucketNames.every((n) => selected.has(n));
        return (
        <div key={cls} style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
          <button
            type="button"
            onClick={() => onToggleBucket(bucketNames)}
            title={allSelected ? `Deselect all ${CLASSIFICATION_LABELS[cls]} categories` : `Select all ${CLASSIFICATION_LABELS[cls]} categories`}
            style={{
              alignSelf: "flex-start",
              background: "none",
              border: "none",
              padding: "0.05rem 0.2rem",
              margin: "-0.05rem -0.2rem",
              borderRadius: 4,
              fontSize: "0.875rem",
              fontWeight: 600,
              opacity: 0.75,
              cursor: "pointer",
              color: "inherit",
              textAlign: "left",
            }}
          >
            {CLASSIFICATION_LABELS[cls]}
          </button>
          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap" }}>
          {byClass.get(cls)!.map((c) => {
            const IconComp = CATEGORY_ICONS[c.icon || "Circle"] || CATEGORY_ICONS["Circle"];
            const active = selected.has(c.name);
            return (
              <Chip key={c.name} active={active} onClick={() => onToggle(c.name)}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
                  <IconComp size={12} color={active ? "white" : (c.color || "#888")} />
                  {c.name}
                </span>
              </Chip>
            );
          })}
          </div>
        </div>
        );
      })}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "0.2rem 0.65rem",
        borderRadius: 999,
        fontSize: "0.905rem",
        border: "1px solid #888",
        background: active ? "#2a5db0" : "transparent",
        color: active ? "white" : "inherit",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
