"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AppPreferences } from "@/lib/repo/prefsRepo.ts";
import { updateAppPreferences } from "./actions.ts";

interface Props {
  prefs: AppPreferences;
  /** Earliest transaction date in the DB (ignoring the floor), or null if empty. */
  earliestDate: string | null;
}

export function PreferencesClient({ prefs, earliestDate }: Props) {
  const router = useRouter();
  const [dataStartDate, setDataStartDate] = useState(prefs.dataStartDate);
  const [hideExcluded, setHideExcluded] = useState(prefs.hideExcludedByDefault);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; msg: string } | null>(null);

  const dirty =
    dataStartDate !== prefs.dataStartDate || hideExcluded !== prefs.hideExcludedByDefault;

  const onSave = async () => {
    setSaving(true);
    setStatus(null);
    const res = await updateAppPreferences({
      dataStartDate,
      hideExcludedByDefault: hideExcluded,
    });
    setSaving(false);
    if (res.ok) {
      setStatus({ kind: "ok", msg: "Saved." });
      router.refresh();
    } else {
      setStatus({ kind: "error", msg: res.error ?? "Save failed." });
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.75rem" }}>
      {/* Data start date */}
      <section style={cardStyle}>
        <div style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: 4 }}>Data start date</div>
        <p style={{ opacity: 0.7, fontSize: "0.95rem", margin: "0 0 0.9rem" }}>
          The app treats transactions before this date as if they don&apos;t exist — they&apos;re
          hidden from every list, total, and chart (and become the lower bound when you click
          &ldquo;All Time&rdquo;). Your data is never deleted: clear this field to see everything
          again, and imports always load the full history. Net&nbsp;Worth is not affected by this
          setting.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <input
            type="date"
            value={dataStartDate}
            onChange={(e) => setDataStartDate(e.target.value)}
            style={inputStyle}
          />
          {dataStartDate && (
            <button type="button" onClick={() => setDataStartDate("")} style={linkBtnStyle}>
              Clear (show all)
            </button>
          )}
        </div>
        {earliestDate && (
          <div style={{ opacity: 0.55, fontSize: "0.85rem", marginTop: 8 }}>
            Your earliest transaction is {earliestDate}.
          </div>
        )}
      </section>

      {/* Hide excluded by default */}
      <section style={cardStyle}>
        <div style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: 4 }}>
          Hide excluded transactions by default
        </div>
        <p style={{ opacity: 0.7, fontSize: "0.95rem", margin: "0 0 0.9rem" }}>
          When on, transaction tables (Transactions, Dashboard, category and merchant pages) hide
          excluded rows unless you switch the per-table control to show them. When off, excluded
          rows show by default.
        </p>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={hideExcluded}
            onChange={(e) => setHideExcluded(e.target.checked)}
            style={{ width: 16, height: 16 }}
          />
          <span style={{ fontSize: "0.975rem" }}>Hide excluded by default</span>
        </label>
      </section>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button
          type="button"
          onClick={onSave}
          disabled={saving || !dirty}
          style={{
            padding: "0.55rem 1.25rem",
            borderRadius: 8,
            border: "none",
            background: saving || !dirty ? "#9ca3af" : "#1a1f3a",
            color: "#fff",
            fontWeight: 600,
            fontSize: "0.975rem",
            cursor: saving || !dirty ? "default" : "pointer",
          }}
        >
          {saving ? "Saving…" : "Save preferences"}
        </button>
        {status && (
          <span
            style={{
              fontSize: "0.9rem",
              color: status.kind === "ok" ? "#15803d" : "#dc2626",
              fontWeight: 600,
            }}
          >
            {status.msg}
          </span>
        )}
      </div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  padding: "1.25rem 1.4rem",
  background: "#fff",
};

const inputStyle: React.CSSProperties = {
  fontFamily: "inherit",
  fontSize: "0.95rem",
  padding: "0.4rem 0.6rem",
  borderRadius: 6,
  border: "1px solid rgba(0,0,0,0.25)",
};

const linkBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#2563eb",
  cursor: "pointer",
  fontSize: "0.9rem",
  padding: 0,
};
