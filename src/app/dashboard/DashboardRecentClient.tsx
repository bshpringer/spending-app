"use client";

import { useState, useTransition, useEffect } from "react";
import { BulkEditTable, type TxRow, type AccountInfo, type ColumnDef } from "../transactions/BulkEditTable.tsx";
import { AccordionPagination } from "../transactions/AccordionPagination.tsx";
import { getTransactionsPage } from "@/lib/actions.ts";
import type { TransactionFilters } from "@/lib/repo/transactionRepo.ts";
import { usePreferences } from "@/components/PreferencesContext.tsx";

interface Props {
  initialRows: TxRow[];
  initialTotal: number;
  initialLinkedRefunds: Record<string, TxRow[]>;
  baseFilters: TransactionFilters;
  pageSize: number;
  accounts: AccountInfo[];
  columns: ColumnDef[];
  availableTags: { id: string; displayName: string }[];
  availableCategories: string[];
  profiles: { id: string; displayName: string; color?: string }[];
}

export function DashboardRecentClient({
  initialRows,
  initialTotal,
  initialLinkedRefunds,
  baseFilters,
  pageSize,
  accounts,
  columns,
  availableTags,
  availableCategories,
  profiles,
}: Props) {
  const { hideExcludedByDefault } = usePreferences();
  const [page, setPage] = useState(0);
  const [hideExcluded, setHideExcluded] = useState(hideExcludedByDefault);
  const [rows, setRows] = useState<TxRow[]>(initialRows);
  const [total, setTotal] = useState<number>(initialTotal);
  const [linkedRefunds, setLinkedRefunds] = useState<Map<string, TxRow[]>>(
    new Map(Object.entries(initialLinkedRefunds)),
  );
  const [loading, setLoading] = useState(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    setPage(0);
    // Reset to the global default (not hardcoded false) — otherwise the
    // "hide excluded by default" pref is clobbered on mount / fresh server data.
    setHideExcluded(hideExcludedByDefault);
    setRows(initialRows);
    setTotal(initialTotal);
    setLinkedRefunds(new Map(Object.entries(initialLinkedRefunds)));
  }, [initialRows, initialTotal, initialLinkedRefunds, hideExcludedByDefault]);

  function fetchPage(nextPage: number, nextHideExcluded: boolean) {
    setLoading(true);
    startTransition(async () => {
      const result = await getTransactionsPage(
        { ...baseFilters, excludedFilter: nextHideExcluded ? "hide" : "all" },
        nextPage * pageSize,
        pageSize,
      );
      setRows(result.rows as TxRow[]);
      setTotal(result.total);
      setLinkedRefunds(
        new Map(Object.entries(result.linkedRefunds).map(([k, v]) => [k, v as TxRow[]])),
      );
      setPage(nextPage);
      setHideExcluded(nextHideExcluded);
      setLoading(false);
    });
  }

  return (
    <>
      <BulkEditTable
        transactions={rows}
        accounts={accounts}
        columns={columns}
        availableTags={availableTags}
        availableCategories={availableCategories}
        profiles={profiles}
        linkedRefunds={linkedRefunds}
        linkName
        linkCategory
        embedded
        hideExcluded={hideExcluded}
        onHideExcludedChange={(next) => fetchPage(0, next)}
        toolbarExtras={
          total > pageSize ? (
            <AccordionPagination
              page={page}
              pageSize={pageSize}
              total={total}
              loading={loading}
              onPage={(p) => fetchPage(p, hideExcluded)}
            />
          ) : null
        }
      />
      {total > pageSize && (
        <div style={{ display: "flex", justifyContent: "flex-start" }}>
          <AccordionPagination
            page={page}
            pageSize={pageSize}
            total={total}
            loading={loading}
            onPage={(p) => fetchPage(p, hideExcluded)}
          />
        </div>
      )}
    </>
  );
}
