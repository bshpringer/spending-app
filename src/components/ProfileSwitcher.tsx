"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { useProfile } from "./ProfileContext.tsx";

interface ProfileOption {
  id: string;
  displayName: string;
  color?: string;
}

interface Props {
  profiles: ProfileOption[];
}

export function ProfileSwitcher({ profiles }: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { activeProfile: contextProfile, setActiveProfile } = useProfile();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // URL param overrides context (for deep-linking), but context is the
  // persistent default. On first mount, if the URL has a profile param that
  // differs from the context, sync context → URL direction is handled below.
  const urlProfile = searchParams.get("profile");
  const current = urlProfile ?? contextProfile;
  const activeProfileObj = profiles.find((p) => p.id === current);
  const label = current === "all" ? "All profiles" : activeProfileObj?.displayName ?? "All profiles";
  const activeColor = current === "all" ? "#888" : activeProfileObj?.color ?? "#888";

  // If the URL is missing the profile param but context has one, push it into
  // the URL so the server page sees the right filter. Only runs once on mount
  // and when navigating to a page that dropped the param.
  useEffect(() => {
    if (contextProfile && contextProfile !== "all" && !urlProfile) {
      const params = new URLSearchParams(searchParams.toString());
      params.set("profile", contextProfile);
      router.replace(`${pathname}?${params.toString()}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  function select(id: string) {
    // Persist to localStorage + cookie via context.
    setActiveProfile(id);
    // Also push to URL for server pages.
    const params = new URLSearchParams(searchParams.toString());
    if (id === "all") params.delete("profile");
    else params.set("profile", id);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
    setOpen(false);
  }

  return (
    <div ref={ref} style={{ position: "relative", marginLeft: 8 }}>
      <button
        onClick={() => setOpen((x) => !x)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 10px",
          fontSize: 14,
          border: "1px solid rgba(255,255,255,0.3)",
          borderRadius: 5,
          cursor: "pointer",
          background: open ? "rgba(255,255,255,0.15)" : "transparent",
          color: "rgba(255,255,255,0.9)",
          fontWeight: 500,
        }}
        title="Switch profile"
      >
        <span
          style={{
            width: 9,
            height: 9,
            borderRadius: "50%",
            background: activeColor,
            border: "1px solid rgba(255,255,255,0.4)",
            display: "inline-block",
          }}
        />
        <span>{label}</span>
        <span style={{ opacity: 0.6, fontSize: 10 }}>▾</span>
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            background: "#fff",
            border: "1px solid #ddd",
            borderRadius: 6,
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            minWidth: 180,
            zIndex: 200,
            padding: "4px 0",
          }}
        >
          <Item
            label="All profiles"
            color="#888"
            active={current === "all"}
            onClick={() => select("all")}
          />
          <div style={{ height: 1, background: "#eee", margin: "4px 0" }} />
          {profiles.map((p) => (
            <Item
              key={p.id}
              label={p.displayName}
              color={p.color ?? "#888"}
              active={current === p.id}
              onClick={() => select(p.id)}
            />
          ))}
          <div style={{ height: 1, background: "#eee", margin: "4px 0" }} />
          <Link
            href="/settings/profiles"
            onClick={() => setOpen(false)}
            style={{
              display: "block",
              padding: "6px 12px",
              fontSize: 13,
              color: "#555",
              textDecoration: "none",
            }}
          >
            Manage profiles…
          </Link>
        </div>
      )}
    </div>
  );
}

function Item({
  label,
  color,
  active,
  onClick,
}: {
  label: string;
  color: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        padding: "6px 12px",
        background: active ? "#f3f4f6" : "transparent",
        border: "none",
        textAlign: "left",
        cursor: "pointer",
        fontSize: 14,
        color: "#111",
        fontWeight: active ? 600 : 400,
      }}
    >
      <span
        style={{
          width: 9,
          height: 9,
          borderRadius: "50%",
          background: color,
          display: "inline-block",
          flexShrink: 0,
        }}
      />
      <span>{label}</span>
    </button>
  );
}
