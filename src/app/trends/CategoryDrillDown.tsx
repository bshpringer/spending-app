"use client";

import { useEffect, useState, useTransition } from "react";
import { getCategoryTransactionsPage } from "../../lib/actions.ts";
import type { CategoryTxPage } from "../../lib/categoryDateRange.ts";
import { BulkEditTable, type AccountInfo, type ColumnDef, type TxRow } from "../transactions/BulkEditTable.tsx";
import { AccordionPagination } from "../transactions/AccordionPagination.tsx";

interface Props {
  category: string;
  periodFrom: string;
  periodTo: string;
  profileIds: string[] | null;
  accounts: AccountInfo[];
  availableTags: { id: string; displayName: string }[];
  availableCategories: string[];
  profiles?: { id: string; displayName: string; color?: string }[];
}

const PAGE_SIZE = 5;

const DRILL_COLUMNS: ColumnDef[] = [
  { key: "date", label: "Date" },
  { key: "name", label: "Name" },
  { key: "category", label: "Category" },
  { key: "amount", label: "Amount" },
  { key: "account", label: "Account" },
  { key: "tags", label: "Tags" },
  { key: "edit", label: "" },
];

type DrillSortKey = "date" | "name" | "amount";

export function CategoryDrillDown({
  category,
  periodFrom,
  periodTo,
  profileIds,
  accounts,
  availableTags,
  availableCategories,
  profiles,
}: Props) {
  const [page, setPage] = useState(0);
  const [data, setData] = useState<CategoryTxPage | null>(null);
  const [loading, startLoad] = useTransition();
  // null = default server sort (ABS(amount) DESC). Once the user clicks a
  // column header we switch to a signed-amount/date/name sort on the full set
  // so pagination is cosmetic — page 2 shows the next 5 rows in the same
  // global order, not a re-sort of just the current page.
  const [sortKey, setSortKey] = useState<DrillSortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function loadPage(p: number, key: DrillSortKey | null, dir: "asc" | "desc") {
    startLoad(async () => {
      const result = await getCategoryTransactionsPage(
        category === "Uncategorized" ? "" : category,
        periodFrom,
        periodTo,
        p * PAGE_SIZE,
        PAGE_SIZE,
        profileIds,
        "amountAbsDesc",
        key,
        dir,
      );
      setData(result);
      setPage(p);
    });
  }

  useEffect(() => {
    setData(null);
    setPage(0);
    setSortKey(null);
    setSortDir("desc");
    loadPage(0, null, "desc");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, periodFrom, periodTo, profileIds?.join(",")]);

  function onSortChange(key: string, dir: "asc" | "desc") {
    if (key !== "date" && key !== "name" && key !== "amount") return;
    setSortKey(key);
    setSortDir(dir);
    loadPage(0, key, dir);
  }

  const txRows: TxRow[] = data ? (data.rows as unknown as TxRow[]) : [];
  const linkedRefunds = data
    ? new Map(Object.entries(data.linkedRefunds).map(([k, v]) => [k, v as unknown as TxRow[]]))
    : undefined;

  return (
    <div
      style={{
        background: "#fafbfc",
        padding: "0.5rem 0.75rem 0.75rem",
        marginTop: 8,
        borderRadius: 8,
        border: "1px solid #f3f4f6",
        overflow: "hidden",
      }}
    >
      {loading && !data && <div style={{ color: "#999", padding: "0.5rem 0" }}>Loading…</div>}
      {data && (
        <div style={{ opacity: loading ? 0.5 : 1, transition: "opacity 0.1s" }}>
          <BulkEditTable
            transactions={txRows}
            accounts={accounts}
            columns={DRILL_COLUMNS}
            availableTags={availableTags}
            availableCategories={availableCategories}
            profiles={profiles}
            linkedRefunds={linkedRefunds}
            embedded
            controlledSort={{ sortKey, sortDir, onChange: onSortChange }}
            linkName
            linkCategory
            emptyMessage="No transactions in this period."
            toolbarExtras={
              <AccordionPagination
                page={page}
                pageSize={PAGE_SIZE}
                total={data.total}
                loading={loading}
                onPage={(p) => loadPage(p, sortKey, sortDir)}
              />
            }
          />
        </div>
      )}
    </div>
  );
}
