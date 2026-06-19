"use client";

import { useState, useTransition } from "react";
import {
  renameAccount,
  setAccountArchived,
  addAccountTag,
  removeAccountTag,
  setAccountProfile,
  setAccountGroup,
} from "@/lib/actions";
import type { Account } from "@/lib/types";
import {
  ACCOUNT_GROUPS,
  ACCOUNT_GROUP_LABELS,
  type AccountGroup,
} from "@/lib/accountGroups";

interface Props {
  account: Account;
  allTags: { id: string; displayName: string }[];
  transactionCount: number;
  profiles: { id: string; displayName: string; color?: string }[];
}

export function AccountRow({ account, allTags, transactionCount, profiles }: Props) {
  const [pending, startTransition] = useTransition();
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(account.customName ?? "");
  const [newTagInput, setNewTagInput] = useState("");

  const tagSet = new Set(account.tags);
  const tagDisplayById = new Map(allTags.map((t) => [t.id, t.displayName]));
  const otherTags = allTags.filter((t) => !tagSet.has(t.id));

  function saveName() {
    setEditingName(false);
    if ((account.customName ?? "") === nameDraft) return;
    startTransition(() => renameAccount(account.id, nameDraft || null));
  }

  function toggleArchived() {
    startTransition(() => setAccountArchived(account.id, !account.archived));
  }

  function addTagByDisplay(displayName: string) {
    if (!displayName.trim()) return;
    startTransition(() => addAccountTag(account.id, displayName));
  }

  function removeTag(tagId: string) {
    startTransition(() => removeAccountTag(account.id, tagId));
  }

  function changeProfile(profileId: string) {
    if (profileId === account.profileId) return;
    startTransition(() => setAccountProfile(account.id, profileId));
  }

  function changeGroup(group: AccountGroup) {
    if (group === account.accountGroup) return;
    startTransition(() => setAccountGroup(account.id, group));
  }

  function submitNewTag(e: React.FormEvent) {
    e.preventDefault();
    if (!newTagInput.trim()) return;
    addTagByDisplay(newTagInput);
    setNewTagInput("");
  }

  return (
    <div
      style={{
        border: "1px solid #ddd",
        borderRadius: 6,
        padding: "1rem",
        opacity: account.archived ? 0.55 : 1,
        display: "flex",
        flexDirection: "column",
        gap: "0.6rem",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: "1rem", flexWrap: "wrap" }}>
        <div style={{ fontSize: "1.125rem", fontWeight: 600 }}>
          {account.institutionName} ••{account.accountNumberLast4}
        </div>
        <div style={{ fontSize: "0.925rem", opacity: 0.65 }}>{account.accountType}</div>
        <div style={{ fontSize: "0.925rem", opacity: 0.65 }}>
          {transactionCount} txn{transactionCount === 1 ? "" : "s"}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <label style={{ fontSize: "0.925rem", opacity: 0.75, display: "flex", gap: "0.25rem" }}>
            <input
              type="checkbox"
              checked={account.archived}
              onChange={toggleArchived}
              disabled={pending}
            />
            Archived
          </label>
        </div>
      </div>

      <div style={{ fontSize: "0.975rem", opacity: 0.8 }}>
        Raw name: <code style={{ opacity: 0.7 }}>{account.accountName}</code>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", fontSize: "1.025rem" }}>
        <span style={{ minWidth: 100, opacity: 0.65 }}>Profile:</span>
        <select
          value={account.profileId}
          onChange={(e) => changeProfile(e.target.value)}
          disabled={pending}
          style={{
            padding: "0.3rem 0.5rem",
            border: "1px solid #ccc",
            borderRadius: 4,
            fontSize: "1rem",
            minWidth: 220,
          }}
        >
          {profiles.find((p) => p.id === account.profileId) === undefined && (
            <option value={account.profileId}>{account.profileId}</option>
          )}
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>{p.displayName}</option>
          ))}
        </select>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", fontSize: "1.025rem" }}>
        <span style={{ minWidth: 100, opacity: 0.65 }}>Group:</span>
        <select
          value={account.accountGroup ?? "other"}
          onChange={(e) => changeGroup(e.target.value as AccountGroup)}
          disabled={pending}
          title="Determines how this account is grouped in the Dashboard / Net Worth view. Edit to override Plaid's default classification (e.g. mark a 401(k) as Retirement)."
          style={{
            padding: "0.3rem 0.5rem",
            border: "1px solid #ccc",
            borderRadius: 4,
            fontSize: "1rem",
            minWidth: 220,
          }}
        >
          {ACCOUNT_GROUPS.map((g) => (
            <option key={g} value={g}>{ACCOUNT_GROUP_LABELS[g]}</option>
          ))}
        </select>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", fontSize: "1.025rem" }}>
        <span style={{ minWidth: 100, opacity: 0.65 }}>Custom name:</span>
        {editingName ? (
          <>
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveName();
                if (e.key === "Escape") {
                  setNameDraft(account.customName ?? "");
                  setEditingName(false);
                }
              }}
              placeholder="(none)"
              style={{
                padding: "0.3rem 0.5rem",
                border: "1px solid #ccc",
                borderRadius: 4,
                fontSize: "1.025rem",
                minWidth: 220,
              }}
            />
          </>
        ) : (
          <button
            type="button"
            onClick={() => {
              setNameDraft(account.customName ?? "");
              setEditingName(true);
            }}
            style={{
              padding: "0.25rem 0.5rem",
              border: "1px dashed #ccc",
              borderRadius: 4,
              background: "transparent",
              color: "inherit",
              font: "inherit",
              cursor: "pointer",
              textAlign: "left",
              minWidth: 220,
            }}
          >
            {account.customName ?? <span style={{ opacity: 0.5 }}>(click to set)</span>}
          </button>
        )}
      </div>

      <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start", fontSize: "1.025rem" }}>
        <span style={{ minWidth: 100, opacity: 0.65, paddingTop: "0.2rem" }}>Tags:</span>
        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", flex: 1 }}>
          {account.tags.length === 0 && (
            <span style={{ opacity: 0.5, fontSize: "0.975rem", paddingTop: "0.2rem" }}>
              No tags yet
            </span>
          )}
          {account.tags.map((tagId) => (
            <span
              key={tagId}
              style={{
                padding: "0.2rem 0.5rem 0.2rem 0.65rem",
                borderRadius: 999,
                fontSize: "0.905rem",
                background: "#2a5db0",
                color: "white",
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem",
              }}
            >
              {tagDisplayById.get(tagId) ?? tagId}
              <button
                type="button"
                onClick={() => removeTag(tagId)}
                disabled={pending}
                aria-label={`Remove ${tagId}`}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "white",
                  cursor: "pointer",
                  fontSize: "1.025rem",
                  padding: 0,
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", fontSize: "0.975rem" }}>
        <span style={{ minWidth: 100, opacity: 0.65 }}>Add tag:</span>
        {otherTags.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => addTagByDisplay(t.displayName)}
            disabled={pending}
            style={{
              padding: "0.18rem 0.55rem",
              borderRadius: 999,
              fontSize: "0.905rem",
              border: "1px dashed #888",
              background: "transparent",
              color: "inherit",
              cursor: "pointer",
            }}
          >
            + {t.displayName}
          </button>
        ))}
        <form onSubmit={submitNewTag} style={{ display: "inline-flex", gap: "0.3rem" }}>
          <input
            value={newTagInput}
            onChange={(e) => setNewTagInput(e.target.value)}
            placeholder="new tag…"
            style={{
              padding: "0.18rem 0.45rem",
              border: "1px solid #ccc",
              borderRadius: 4,
              fontSize: "0.925rem",
              width: 100,
            }}
          />
          <button
            type="submit"
            disabled={pending || !newTagInput.trim()}
            style={{
              padding: "0.18rem 0.55rem",
              border: "1px solid #ccc",
              borderRadius: 4,
              background: "transparent",
              color: "inherit",
              cursor: "pointer",
              fontSize: "0.925rem",
            }}
          >
            Add
          </button>
        </form>
      </div>
    </div>
  );
}
