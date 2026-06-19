"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BulkEditTable, type TxRow, type AccountInfo, type ColumnDef } from "./BulkEditTable.tsx";
import { AccordionPagination } from "./AccordionPagination.tsx";
import { getTransactionsPage } from "@/lib/actions.ts";
import type { TransactionFilters } from "@/lib/repo/transactionRepo.ts";
import { usePreferences } from "@/components/PreferencesContext.tsx";

interface Props {
  initialRows: TxRow[];
  initialTotal: number;
  initialLinkedRefunds: Record<string, TxRow[]>;
  filters: TransactionFilters;
  pageSize: number;
  accounts: AccountInfo[];
  columns: ColumnDef[];
  availableTags: { id: string; displayName: string }[];
  availableCategories: string[];
  profiles: { id: string; displayName: string; color?: string }[];
}

export function TransactionsTableClient({
  initialRows,
  initialTotal,
  initialLinkedRefunds,
  filters,
  pageSize,
  accounts,
  columns,
  availableTags,
  availableCategories,
  profiles,
}: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<TxRow[]>(initialRows);
  const [total, setTotal] = useState<number>(initialTotal);
  const [linkedRefunds, setLinkedRefunds] = useState<Map<string, TxRow[]>>(
    new Map(Object.entries(initialLinkedRefunds)),
  );
  const [loading, setLoading] = useState(false);
  const [, startTransition] = useTransition();

  // When the server re-renders with new initial data (URL filter changed),
  // reset local pagination + rows to the new server-provided values.
  useEffect(() => {
    setPage(0);
    setRows(initialRows);
    setTotal(initialTotal);
    setLinkedRefunds(new Map(Object.entries(initialLinkedRefunds)));
  }, [initialRows, initialTotal, initialLinkedRefunds]);

  function loadPage(nextPage: number) {
    setLoading(true);
    startTransition(async () => {
      const result = await getTransactionsPage(filters, nextPage * pageSize, pageSize);
      setRows(result.rows as TxRow[]);
      setTotal(result.total);
      setLinkedRefunds(
        new Map(Object.entries(result.linkedRefunds).map(([k, v]) => [k, v as TxRow[]])),
      );
      setPage(nextPage);
      setLoading(false);
    });
  }

  const { hideExcludedByDefault } = usePreferences();
  const hideExcluded = (filters.excludedFilter ?? "all") === "hide";
  function handleHideExcludedChange(next: boolean) {
    const params = new URLSearchParams(sp?.toString() ?? "");
    // Mirror the filter bar's "omit the param at the default value" rule so the
    // checkbox and the Excluded dropdown stay in sync — and so unchecking when
    // "hide" is the default writes an explicit `excluded=all` (otherwise the
    // server would just re-apply the hide default and the box couldn't toggle).
    if (next) {
      if (hideExcludedByDefault) params.delete("excluded");
      else params.set("excluded", "hide");
    } else {
      if (hideExcludedByDefault) params.set("excluded", "all");
      else params.delete("excluded");
    }
    const qs = params.toString();
    router.push(qs ? `/transactions?${qs}` : "/transactions");
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
        hideExcluded={hideExcluded}
        onHideExcludedChange={handleHideExcludedChange}
        toolbarExtras={
          total > pageSize ? (
            <AccordionPagination
              page={page}
              pageSize={pageSize}
              total={total}
              loading={loading}
              onPage={loadPage}
            />
          ) : null
        }
      />
      {total > pageSize && (
        <div style={{ marginTop: "1rem", display: "flex", justifyContent: "flex-start" }}>
          <AccordionPagination
            page={page}
            pageSize={pageSize}
            total={total}
            loading={loading}
            onPage={loadPage}
          />
        </div>
      )}
    </>
  );
}
