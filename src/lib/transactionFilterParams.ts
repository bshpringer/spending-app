import type { TransactionFilters } from "@/lib/repo/transactionRepo";
import { resolveProfileFilter } from "@/lib/auth";

// Shared parser that turns a Next.js `searchParams` bag into a fully-typed
// `TransactionFilters` plus the auxiliary bits a page needs for stats rows,
// sort links, and URL rebuilding. Single-sourced here so /transactions and the
// category/merchant detail pages all interpret the same query params
// identically (no client/server drift). See PROJECT_MEMORY → filter conventions.

type RawSearchParams = Record<string, string | string[] | undefined>;

export interface ParsedTransactionFilters {
  filters: TransactionFilters;
  sort: "date" | "amount" | "name" | "category";
  dir: "asc" | "desc";
  excludedFilter: "all" | "hide" | "only";
  oneTimeFilter: "all" | "hide" | "only";
  canonicalFilter: "all" | "missing" | "present";
  sourceFilter?: "csv" | "plaid" | "manual";
  netExcluded: boolean;
  batchId?: string;
  profileParam?: string;
  profileIds: string[] | null;
  amountOp?: "gt" | "lt" | "eq" | "between";
  amountValue?: number;
  amountMax?: number;
  /** Echoed back so callers can diff against the active value (the bar omits the param at this value). */
  defaultExcluded: "all" | "hide";
}

export function firstValue(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

export function csvList(v: string | string[] | undefined): string[] {
  const s = firstValue(v);
  if (!s) return [];
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

export function parseTransactionFilters(
  sp: RawSearchParams,
  opts: { defaultExcluded: "all" | "hide" },
): ParsedTransactionFilters {
  const { defaultExcluded } = opts;

  const rawSort = firstValue(sp.sort);
  const validSort = ["date", "amount", "name", "category"] as const;
  type SortCol = (typeof validSort)[number];
  const sort: SortCol = validSort.includes(rawSort as SortCol) ? (rawSort as SortCol) : "date";
  const dir: "asc" | "desc" = firstValue(sp.dir) === "asc" ? "asc" : "desc";

  const rawExcluded = firstValue(sp.excluded);
  const excludedFilter =
    rawExcluded === "hide" || rawExcluded === "only" || rawExcluded === "all"
      ? rawExcluded
      : defaultExcluded;
  const rawOneTime = firstValue(sp.oneTime);
  const oneTimeFilter = rawOneTime === "hide" || rawOneTime === "only" ? rawOneTime : "all";
  const rawCanonical = firstValue(sp.canonical);
  const canonicalFilter = rawCanonical === "missing" || rawCanonical === "present" ? rawCanonical : "all";
  const rawSource = firstValue(sp.source);
  const sourceFilter: "csv" | "plaid" | "manual" | undefined =
    rawSource === "csv" || rawSource === "plaid" || rawSource === "manual" ? rawSource : undefined;
  const netExcluded = firstValue(sp.netExcluded) === "1";
  const batchId = firstValue(sp.batch);
  const profileParam = firstValue(sp.profile);
  const profileIds = resolveProfileFilter(profileParam);

  const rawAmountOp = firstValue(sp.amountOp);
  const amountOp: TransactionFilters["amountOp"] | undefined =
    rawAmountOp === "gt" || rawAmountOp === "lt" || rawAmountOp === "eq" || rawAmountOp === "between"
      ? rawAmountOp
      : undefined;
  const parsedAmountValue = Number.parseFloat(firstValue(sp.amountVal) ?? "");
  const parsedAmountMax = Number.parseFloat(firstValue(sp.amountMax) ?? "");
  const amountValue = Number.isFinite(parsedAmountValue) ? parsedAmountValue : undefined;
  const amountMax = Number.isFinite(parsedAmountMax) ? parsedAmountMax : undefined;

  const filters: TransactionFilters = {
    search: firstValue(sp.q),
    tagIds: csvList(sp.tags),
    accountIds: csvList(sp.accounts),
    categories: csvList(sp.categories),
    from: firstValue(sp.from),
    to: firstValue(sp.to),
    sort,
    dir,
    excludedFilter,
    oneTimeFilter,
    canonicalFilter,
    source: sourceFilter,
    importBatchId: batchId,
    profileIds: profileIds ?? undefined,
    amountOp,
    amountValue,
    amountMax,
  };

  return {
    filters,
    sort,
    dir,
    excludedFilter,
    oneTimeFilter,
    canonicalFilter,
    sourceFilter,
    netExcluded,
    batchId,
    profileParam,
    profileIds,
    amountOp,
    amountValue,
    amountMax,
    defaultExcluded,
  };
}
