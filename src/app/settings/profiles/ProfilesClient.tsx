"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createProfile, updateProfile, archiveProfile } from "@/lib/actions";

interface ProfileItem {
  id: string;
  displayName: string;
  color?: string;
  isShared: boolean;
  count: number;
}

interface Props {
  profiles: ProfileItem[];
}

const DEFAULT_COLORS = ["#1a1f3a", "#9333ea", "#0ea5e9", "#16a34a", "#dc2626", "#d97706", "#475569"];

export function ProfilesClient({ profiles }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(DEFAULT_COLORS[0]);
  const [newShared, setNewShared] = useState(false);

  function resetNew() {
    setNewId("");
    setNewName("");
    setNewColor(DEFAULT_COLORS[0]);
    setNewShared(false);
    setAdding(false);
  }

  function submitNew() {
    if (!newId.trim() || !newName.trim()) return;
    startTransition(async () => {
      await createProfile({ id: newId.trim(), displayName: newName.trim(), color: newColor, isShared: newShared });
      resetNew();
      router.refresh();
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {profiles.map((p) => (
        <ProfileRow key={p.id} profile={p} pending={pending} />
      ))}

      {adding ? (
        <div style={cardStyle}>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
            <input
              autoFocus
              placeholder="slug (e.g. emma)"
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              style={{ ...inputStyle, width: 160 }}
            />
            <input
              placeholder="display name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              style={{ ...inputStyle, width: 200 }}
            />
            <div style={{ display: "flex", gap: 4 }}>
              {DEFAULT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setNewColor(c)}
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 4,
                    background: c,
                    border: newColor === c ? "2px solid #000" : "1px solid #ccc",
                    cursor: "pointer",
                  }}
                  title={c}
                />
              ))}
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.945rem" }}>
              <input type="checkbox" checked={newShared} onChange={(e) => setNewShared(e.target.checked)} />
              Shared
            </label>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
            <button type="button" onClick={submitNew} disabled={pending || !newId.trim() || !newName.trim()} style={primaryBtn}>
              {pending ? "Creating…" : "Create profile"}
            </button>
            <button type="button" onClick={resetNew} disabled={pending} style={secondaryBtn}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} style={{ ...secondaryBtn, alignSelf: "flex-start" }}>
          + New profile
        </button>
      )}
    </div>
  );
}

function ProfileRow({ profile, pending }: { profile: ProfileItem; pending: boolean }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(profile.displayName);
  const [color, setColor] = useState(profile.color ?? "#888888");
  const [confirmArchive, setConfirmArchive] = useState(false);

  function save() {
    startTransition(async () => {
      await updateProfile(profile.id, { displayName: name, color });
      setEditing(false);
      router.refresh();
    });
  }

  function archive() {
    startTransition(async () => {
      await archiveProfile(profile.id);
      setConfirmArchive(false);
      router.refresh();
    });
  }

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
        <span
          style={{
            width: 18,
            height: 18,
            borderRadius: "50%",
            background: color,
            border: "1px solid #ccc",
            flexShrink: 0,
          }}
        />
        {editing ? (
          <>
            <input value={name} onChange={(e) => setName(e.target.value)} style={{ ...inputStyle, width: 200 }} />
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 40, height: 32, padding: 0, border: "1px solid #ccc", borderRadius: 4 }} />
          </>
        ) : (
          <>
            <strong style={{ fontSize: "1.075rem" }}>{profile.displayName}</strong>
            <code style={{ opacity: 0.55, fontSize: "0.875rem" }}>{profile.id}</code>
            {profile.isShared && (
              <span style={{ fontSize: "0.8rem", border: "1px solid #0ea5e9", color: "#0ea5e9", borderRadius: 3, padding: "0.1rem 0.4rem" }}>
                Shared
              </span>
            )}
          </>
        )}
        <span style={{ marginLeft: "auto", fontSize: "0.925rem", opacity: 0.65 }}>
          {profile.count} txn{profile.count === 1 ? "" : "s"}
        </span>
      </div>
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
        {editing ? (
          <>
            <button type="button" onClick={save} disabled={pending} style={primaryBtn}>Save</button>
            <button type="button" onClick={() => { setEditing(false); setName(profile.displayName); setColor(profile.color ?? "#888888"); }} disabled={pending} style={secondaryBtn}>Cancel</button>
          </>
        ) : confirmArchive ? (
          <>
            <span style={{ fontSize: "0.925rem", color: "#a00", marginRight: "auto" }}>
              Archive {profile.displayName}? Transactions keep this profileId but the profile disappears from the nav.
            </span>
            <button type="button" onClick={archive} disabled={pending} style={dangerBtn}>Confirm archive</button>
            <button type="button" onClick={() => setConfirmArchive(false)} disabled={pending} style={secondaryBtn}>Cancel</button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => setEditing(true)} disabled={pending} style={secondaryBtn}>Edit</button>
            <button type="button" onClick={() => setConfirmArchive(true)} disabled={pending} style={{ ...secondaryBtn, color: "#a00", borderColor: "#a00" }}>
              Archive
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  border: "1px solid #ddd",
  borderRadius: 6,
  padding: "1rem",
  background: "#fff",
};
const inputStyle: React.CSSProperties = {
  padding: "0.35rem 0.5rem",
  border: "1px solid #ccc",
  borderRadius: 4,
  fontSize: "0.975rem",
};
const primaryBtn: React.CSSProperties = {
  padding: "0.4rem 0.9rem",
  border: "none",
  borderRadius: 4,
  background: "#333",
  color: "#fff",
  cursor: "pointer",
  fontSize: "0.945rem",
};
const secondaryBtn: React.CSSProperties = {
  padding: "0.4rem 0.9rem",
  border: "1px solid #ccc",
  borderRadius: 4,
  background: "transparent",
  cursor: "pointer",
  fontSize: "0.945rem",
};
const dangerBtn: React.CSSProperties = {
  padding: "0.4rem 0.9rem",
  border: "none",
  borderRadius: 4,
  background: "#a00",
  color: "#fff",
  cursor: "pointer",
  fontSize: "0.945rem",
};
