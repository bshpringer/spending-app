"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { DETAIL_GRANULARITIES, type DetailGranularity } from "@/lib/detailChart.ts";

// Month / Quarter / Year toggle for the detail-page bar chart. Writes ?chartG=
// (omitted at the "month" default), which re-buckets server-side. The bar
// selection is client state and resets automatically on the re-render.
export function ChartGranularityPills({ current }: { current: DetailGranularity }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setGranularity(g: DetailGranularity) {
    const next = new URLSearchParams(searchParams.toString());
    if (g === "month") next.delete("chartG");
    else next.set("chartG", g);
    next.delete("page");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div style={{ display: "flex", gap: "0.25rem", flexShrink: 0 }}>
      {DETAIL_GRANULARITIES.map(({ key, label }) => {
        const active = current === key;
        return (
          <button
            key={key}
            onClick={() => setGranularity(key)}
            style={{
              padding: "0.25rem 0.6rem",
              fontSize: "0.825rem",
              fontWeight: 600,
              border: `1px solid ${active ? "#374151" : "#ddd"}`,
              background: active ? "#374151" : "#fff",
              color: active ? "#fff" : "#555",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
