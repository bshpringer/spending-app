"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createManualTransaction } from "@/lib/actions.ts";
import { DEFAULT_PROFILE_ID } from "@/lib/constants.ts";

interface Props {
  accounts: { id: string; label: string; profileId: string }[];
  availableCategories: string[];
  availableTags: { id: string; displayName: string }[];
  profiles: { id: string; displayName: string; color?: string }[];
  defaultProfileId?: string;
}

export function ManualEntryModal({ accounts, availableCategories, availableTags, profiles, defaultProfileId }: Props) {
  const router = useRouter();
  const fallbackProfileId = defaultProfileId ?? profiles[0]?.id ?? DEFAULT_PROFILE_ID;
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [name, setName] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [sign, setSign] = useState<"expense" | "income">("expense");
  const [accountId, setAccountId] = useState<string>("");
  const [profileId, setProfileId] = useState<string>(fallbackProfileId);
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  function reset() {
    setDate(new Date().toISOString().slice(0, 10));
    setName("");
    setAmountStr("");
    setSign("expense");
    setAccountId("");
    setProfileId(fallbackProfileId);
    setCategory("");
    setNote("");
    setTags([]);
  }

  function handleAccountChange(nextAccountId: string) {
    setAccountId(nextAccountId);
    if (nextAccountId) {
      const acct = accounts.find((a) => a.id === nextAccountId);
      if (acct) setProfileId(acct.profileId);
    }
  }

  function toggleTag(id: string) {
    setTags((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  }

  async function handleSave() {
    const raw = parseFloat(amountStr);
    if (!Number.isFinite(raw) || raw === 0) return;
    if (!name.trim()) return;
    const signed = sign === "expense" ? -Math.abs(raw) : Math.abs(raw);
    setSaving(true);
    try {
      await createManualTransaction({
        date,
        name: name.trim(),
        amount: signed,
        accountId: accountId || null,
        profileId,
        category: category || undefined,
        note: note.trim() || undefined,
        tags,
      });
      setOpen(false);
      reset();
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const canSave = name.trim().length > 0 && parseFloat(amountStr) > 0 && !saving;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{
          padding: "0.4rem 0.9rem",
          border: "1px solid #333",
          borderRadius: 4,
          background: "#333",
          color: "#fff",
          cursor: "pointer",
          fontSize: "0.945rem",
        }}
      >
        + Add transaction
      </button>

      {open && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onClick={() => setOpen(false)}
          onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 8,
              padding: "1.5rem",
              width: 480,
              maxWidth: "90vw",
              maxHeight: "85vh",
              overflowY: "auto",
              boxShadow: "0 4px 24px rgba(0,0,0,0.18)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ margin: "0 0 1rem", fontSize: "1.125rem", fontWeight: 600 }}>
              Add transaction
            </h2>

            <div style={{ display: "flex", gap: "1rem" }}>
              <div style={{ flex: 1 }}>
                <Field label="Date">
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
                </Field>
              </div>
              <div style={{ flex: 1 }}>
                <Field label="Amount">
                  <div style={{ display: "flex", gap: "0.4rem" }}>
                    <select value={sign} onChange={(e) => setSign(e.target.value as "expense" | "income")} style={{ ...inputStyle, width: "auto", flex: "0 0 auto" }}>
                      <option value="expense">−</option>
                      <option value="income">+</option>
                    </select>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={amountStr}
                      onChange={(e) => setAmountStr(e.target.value)}
                      style={inputStyle}
                    />
                  </div>
                </Field>
              </div>
            </div>

            <Field label="Name">
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Trader Joe's" style={inputStyle} />
            </Field>

            <Field label="Account (optional)">
              <select value={accountId} onChange={(e) => handleAccountChange(e.target.value)} style={inputStyle}>
                <option value="">— None —</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.label}</option>
                ))}
              </select>
            </Field>

            <Field label="Profile">
              <select value={profileId} onChange={(e) => setProfileId(e.target.value)} style={inputStyle}>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>{p.displayName}</option>
                ))}
              </select>
            </Field>

            <Field label="Category">
              <select value={category} onChange={(e) => setCategory(e.target.value)} style={inputStyle}>
                <option value="">— Uncategorized —</option>
                {availableCategories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Field>

            <Field label="Note">
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
            </Field>

            <Field label="Tags">
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.25rem" }}>
                {availableTags.map((tag) => {
                  const active = tags.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => toggleTag(tag.id)}
                      style={{
                        padding: "0.2rem 0.6rem",
                        borderRadius: 999,
                        fontSize: "0.905rem",
                        border: "1px solid",
                        cursor: "pointer",
                        background: active ? "#333" : "transparent",
                        color: active ? "#fff" : "inherit",
                        borderColor: active ? "#333" : "#ccc",
                      }}
                    >
                      {tag.displayName}
                    </button>
                  );
                })}
                {availableTags.length === 0 && (
                  <span style={{ fontSize: "0.925rem", opacity: 0.5 }}>No tags defined yet</span>
                )}
              </div>
            </Field>

            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "1.25rem" }}>
              <button
                type="button"
                onClick={() => { setOpen(false); reset(); }}
                style={{ padding: "0.4rem 0.9rem", border: "1px solid #ccc", borderRadius: 4, background: "transparent", cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!canSave}
                style={{
                  padding: "0.4rem 0.9rem",
                  border: "none",
                  borderRadius: 4,
                  background: canSave ? "#333" : "#999",
                  color: "#fff",
                  cursor: canSave ? "pointer" : "default",
                }}
              >
                {saving ? "Saving…" : "Add transaction"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: "0.9rem" }}>
      {label && (
        <label style={{ display: "block", fontSize: "0.905rem", fontWeight: 600, marginBottom: "0.3rem", opacity: 0.7 }}>
          {label}
        </label>
      )}
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.4rem 0.5rem",
  fontSize: "0.975rem",
  border: "1px solid #ccc",
  borderRadius: 4,
  boxSizing: "border-box",
};
