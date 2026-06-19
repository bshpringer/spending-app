"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { usePreferences } from "@/components/PreferencesContext.tsx";

// Controlled "Hide excluded" wiring for the detail-page BulkEditTable, synced to
// the filter bar's ?excluded URL param. Passing CONTROLLED props is what stops
// the table from ALSO filtering excluded rows locally out of the current page
// slice (BulkEditTable only self-filters in the uncontrolled path) — otherwise
// the table's checkbox and the bar's Excluded dropdown fight, e.g. "Excluded:
// Only" would show an empty table. Mirrors TransactionsTableClient.
export function useExcludedFilterSync() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { hideExcludedByDefault } = usePreferences();

  const current = sp.get("excluded") ?? (hideExcludedByDefault ? "hide" : "all");
  const hideExcluded = current === "hide";

  function onHideExcludedChange(next: boolean) {
    const params = new URLSearchParams(sp.toString());
    // Mirror the bar's "omit the param at the default value" rule so the
    // checkbox and the Excluded dropdown stay in sync, and so unchecking when
    // "hide" is the default writes an explicit excluded=all (the box can toggle
    // off instead of the server re-applying the hide default).
    if (next) {
      if (hideExcludedByDefault) params.delete("excluded");
      else params.set("excluded", "hide");
    } else {
      if (hideExcludedByDefault) params.set("excluded", "all");
      else params.delete("excluded");
    }
    params.delete("page");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  return { hideExcluded, onHideExcludedChange };
}
