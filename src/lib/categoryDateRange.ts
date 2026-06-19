export type RangePreset = "this-month" | "last-month" | "this-year" | "all";

export const RANGE_PRESETS: RangePreset[] = ["this-month", "last-month", "this-year", "all"];

export const RANGE_PRESET_LABELS: Record<RangePreset, string> = {
  "this-month": "This Month",
  "last-month": "Last Month",
  "this-year": "This Year",
  "all": "All Time",
};

function monthBounds(y: number, m: number): { from: string; to: string } {
  const lastDay = new Date(y, m + 1, 0).getDate();
  const mm = String(m + 1).padStart(2, "0");
  return {
    from: `${y}-${mm}-01`,
    to: `${y}-${mm}-${String(lastDay).padStart(2, "0")}`,
  };
}

export function presetBounds(preset: RangePreset): { from?: string; to?: string } {
  if (preset === "all") return {};
  const now = new Date();
  if (preset === "this-month") return monthBounds(now.getFullYear(), now.getMonth());
  if (preset === "last-month") {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return monthBounds(d.getFullYear(), d.getMonth());
  }
  // this-year
  const y = now.getFullYear();
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}

export interface ResolvedRange {
  from?: string;
  to?: string;
  preset: RangePreset | "custom";
}

const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

export function resolveRange(raw: { range?: string; from?: string; to?: string }): ResolvedRange {
  if (raw.range === "custom") {
    const from = raw.from && DATE_RX.test(raw.from) ? raw.from : undefined;
    const to = raw.to && DATE_RX.test(raw.to) ? raw.to : undefined;
    return { from, to, preset: "custom" };
  }
  const preset = (RANGE_PRESETS as string[]).includes(raw.range ?? "")
    ? (raw.range as RangePreset)
    : "this-month";
  return { ...presetBounds(preset), preset };
}

export interface CategoryTxRow {
  id: string;
  date: string;
  originalDate?: string;
  name: string;
  customName?: string;
  canonicalName?: string;
  category: string;
  amount: number;
  note: string;
  tags: string[];
  excluded: boolean;
  oneTime: boolean;
  accountId: string | null;
  profileId?: string;
}

export interface CategoryTxPage {
  rows: CategoryTxRow[];
  total: number;
  /** expenseId → linked refund rows. Refunds in this map are unconditionally
   * suppressed from `rows` so they only render as nested children. */
  linkedRefunds: Record<string, CategoryTxRow[]>;
}
