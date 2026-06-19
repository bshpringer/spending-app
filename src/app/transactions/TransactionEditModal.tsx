"use client";

import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { updateTransaction, deleteTransaction } from "@/lib/actions.ts";
import { DEFAULT_PROFILE_ID } from "@/lib/constants.ts";
import RefundLinkSection from "@/app/refunds/RefundLinkSection.tsx";

interface Props {
  transaction: {
    id: string;
    name: string;
    date: string;
    originalDate?: string;
    amount: number;
    customName?: string;
    canonicalName?: string;
    category: string;
    note: string;
    tags: string[];
    excluded: boolean;
    oneTime: boolean;
    profileId?: string;
    accountLabel?: string;
  };
  availableTags: { id: string; displayName: string }[];
  availableCategories: string[];
  profiles?: { id: string; displayName: string; color?: string }[];
  trigger?: React.ReactNode;
}

export function TransactionEditModal({ transaction, availableTags, availableCategories, profiles, trigger }: Props) {
  const profileList = profiles ?? [];
  const initialProfileId = transaction.profileId ?? profileList[0]?.id ?? DEFAULT_PROFILE_ID;
  const [open, setOpen] = useState(false);
  const [txDate, setTxDate] = useState(transaction.originalDate || transaction.date);
  const [txAmountStr, setTxAmountStr] = useState(transaction.amount.toString());
  const [customName, setCustomName] = useState(transaction.customName ?? "");
  const [canonicalName, setCanonicalName] = useState(transaction.canonicalName ?? "");
  const [category, setCategory] = useState(transaction.category);
  const [note, setNote] = useState(transaction.note);
  const [tags, setTags] = useState<string[]>(transaction.tags);
  const [excluded, setExcluded] = useState(transaction.excluded);
  const [oneTime, setOneTime] = useState(transaction.oneTime);
  const [profileId, setProfileId] = useState<string>(initialProfileId);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) firstInputRef.current?.focus();
  }, [open]);

  // Lock background scroll while the modal is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  function toggleTag(tagId: string) {
    setTags((prev) => (prev.includes(tagId) ? prev.filter((t) => t !== tagId) : [...prev, tagId]));
  }

  function handleOpen() {
    setTxDate(transaction.originalDate || transaction.date);
    setTxAmountStr(transaction.amount.toString());
    setCustomName(transaction.customName ?? "");
    setCanonicalName(transaction.canonicalName ?? "");
    setCategory(transaction.category);
    setNote(transaction.note);
    setTags(transaction.tags);
    setExcluded(transaction.excluded);
    setOneTime(transaction.oneTime);
    setProfileId(initialProfileId);
    setOpen(true);
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteTransaction(transaction.id);
      setOpen(false);
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await updateTransaction(transaction.id, {
        originalDate: txDate,
        amount: parseFloat(txAmountStr) || 0,
        customName: customName.trim() || null,
        canonicalName: canonicalName.trim() || null,
        category,
        note,
        tags,
        excluded,
        oneTime,
        profileId: profileList.length > 0 ? profileId : undefined,
      });
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") setOpen(false);
  }

  return (
    <>
      {trigger && React.isValidElement(trigger) ? (
        React.cloneElement(trigger as React.ReactElement<any>, {
          onClick: (e: React.MouseEvent) => {
            handleOpen();
            const triggerEl = trigger as React.ReactElement<any>;
            if (triggerEl.props.onClick) triggerEl.props.onClick(e);
          },
          style: { cursor: "pointer", ...(trigger as React.ReactElement<any>).props.style },
        })
      ) : (
        <button
          onClick={handleOpen}
          style={{
            padding: "0.2rem 0.5rem",
            fontSize: "0.875rem",
            border: "1px solid #ccc",
            borderRadius: 3,
            background: "transparent",
            cursor: "pointer",
            color: "inherit",
          }}
        >
          Edit
        </button>
      )}

      {open && createPortal(
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            zIndex: 10000,
            display: "flex",
            // Top-align with padding that clears the 54px nav so the modal's
            // header is never hidden behind it; the overlay scrolls when the
            // modal is taller than the viewport.
            alignItems: "flex-start",
            justifyContent: "center",
            overflowY: "auto",
            padding: "70px 16px 32px",
            boxSizing: "border-box",
          }}
          onClick={() => setOpen(false)}
          onKeyDown={handleKeyDown}
        >
          <div
            style={{
              position: "relative",
              background: "#fff",
              borderRadius: 8,
              padding: "1.5rem",
              width: 600,
              maxWidth: "90vw",
              boxShadow: "0 4px 24px rgba(0,0,0,0.18)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              title="Close"
              style={{
                position: "absolute",
                top: 12,
                right: 14,
                background: "none",
                border: "none",
                fontSize: 24,
                lineHeight: 1,
                cursor: "pointer",
                color: "#888",
                padding: 4,
              }}
            >
              ×
            </button>
            <h2 style={{ margin: "0 0 1rem", fontSize: "1.125rem", fontWeight: 600, paddingRight: "1.5rem" }}>
              Edit transaction
            </h2>
            <p style={{ margin: "0 0 1rem", fontSize: "0.925rem", opacity: 0.6 }}>
              {transaction.name}
              {transaction.accountLabel && (
                <span style={{ marginLeft: "0.5rem", opacity: 0.7 }}>· {transaction.accountLabel}</span>
              )}
            </p>

            <div style={{ display: "flex", gap: "1rem" }}>
              <div style={{ flex: 1 }}>
                <Field label="Date">
                  <input
                    type="date"
                    value={txDate}
                    onChange={(e) => setTxDate(e.target.value)}
                    style={inputStyle}
                  />
                </Field>
              </div>
              <div style={{ flex: 1 }}>
                <Field label="Amount">
                  <input
                    type="number"
                    step="0.01"
                    value={txAmountStr}
                    onChange={(e) => setTxAmountStr(e.target.value)}
                    style={inputStyle}
                  />
                </Field>
              </div>
            </div>

            <Field label="Custom name">
              <input
                ref={firstInputRef}
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder={transaction.name}
                style={inputStyle}
              />
            </Field>

            <Field label="Canonical name">
              <input
                type="text"
                value={canonicalName}
                onChange={(e) => setCanonicalName(e.target.value)}
                placeholder={transaction.name}
                style={inputStyle}
              />
            </Field>

            {profileList.length > 0 && (
              <Field label="Profile">
                <select value={profileId} onChange={(e) => setProfileId(e.target.value)} style={inputStyle}>
                  {profileList.map((p) => (
                    <option key={p.id} value={p.id}>{p.displayName}</option>
                  ))}
                </select>
              </Field>
            )}

            <Field label="Category">
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                style={inputStyle}
              >
                {availableCategories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Note">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                style={{ ...inputStyle, resize: "vertical" }}
              />
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

            <RefundLinkSection transactionId={transaction.id} />

            <Field label="">
              <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                <label
                  style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", cursor: "pointer" }}
                >
                  <input
                    type="checkbox"
                    checked={excluded}
                    onChange={(e) => setExcluded(e.target.checked)}
                    style={{ marginTop: "0.15rem" }}
                  />
                  <span>
                    <span style={{ fontSize: "0.975rem", fontWeight: 500 }}>Exclude from everything</span>
                    <span style={{ display: "block", fontSize: "0.845rem", opacity: 0.55, marginTop: "0.1rem" }}>
                      Not real spending (e.g. credit card payment, transfer between accounts).
                    </span>
                  </span>
                </label>
                <label
                  style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", cursor: "pointer" }}
                >
                  <input
                    type="checkbox"
                    checked={oneTime}
                    onChange={(e) => setOneTime(e.target.checked)}
                    style={{ marginTop: "0.15rem" }}
                  />
                  <span>
                    <span style={{ fontSize: "0.975rem", fontWeight: 500 }}>One-time / anomaly</span>
                    <span style={{ display: "block", fontSize: "0.845rem", opacity: 0.55, marginTop: "0.1rem" }}>
                      Real spending, but excluded from monthly trends and pacing.
                    </span>
                  </span>
                </label>
              </div>
            </Field>

            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "1.25rem" }}>
              {confirmDelete ? (
                <>
                  <span style={{ fontSize: "0.925rem", color: "#a00", marginRight: "auto" }}>
                    Delete this transaction permanently?
                  </span>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    disabled={deleting}
                    style={{ padding: "0.4rem 0.9rem", border: "1px solid #ccc", borderRadius: 4, background: "transparent", cursor: deleting ? "default" : "pointer" }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={deleting}
                    style={{ padding: "0.4rem 0.9rem", border: "none", borderRadius: 4, background: "#a00", color: "#fff", cursor: deleting ? "default" : "pointer" }}
                  >
                    {deleting ? "Deleting…" : "Confirm delete"}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    disabled={saving}
                    style={{ padding: "0.4rem 0.9rem", border: "1px solid #a00", color: "#a00", borderRadius: 4, background: "transparent", cursor: "pointer", marginRight: "auto" }}
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    style={{
                      padding: "0.4rem 0.9rem",
                      border: "1px solid #ccc",
                      borderRadius: 4,
                      background: "transparent",
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    style={{
                      padding: "0.4rem 0.9rem",
                      border: "none",
                      borderRadius: 4,
                      background: saving ? "#999" : "#333",
                      color: "#fff",
                      cursor: saving ? "default" : "pointer",
                    }}
                  >
                    {saving ? "Saving…" : "Save"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: "0.9rem" }}>
      {label && (
        <label
          style={{ display: "block", fontSize: "0.905rem", fontWeight: 600, marginBottom: "0.3rem", opacity: 0.7 }}
        >
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
