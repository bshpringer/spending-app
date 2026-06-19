"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { FEATURES } from "@/lib/appMode.ts";
import { useProfile } from "./ProfileContext.tsx";

const SETTINGS_ITEMS = [
  { href: "/settings/rules", label: "Rules" },
  { href: "/settings/accounts", label: "Accounts" },
  // CSV import is hidden in the public (Plaid-first) build; the route still works.
  ...(FEATURES.csvImport ? [{ href: "/settings/import", label: "Imports" }] : []),
  { href: "/settings/plaid", label: "Plaid Import" },
  { href: "/settings/profiles", label: "Profiles" },
  { href: "/settings/preferences", label: "Preferences" },
  { href: "/settings/help", label: "Help & FAQ" },
];

export function SettingsMenu() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { activeProfile } = useProfile();
  const profile = searchParams.get("profile") ?? (activeProfile !== "all" ? activeProfile : null);
  const suffix = profile ? `?profile=${encodeURIComponent(profile)}` : "";
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const active = SETTINGS_ITEMS.some(
    ({ href }) => pathname === href || pathname.startsWith(href + "/"),
  );

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        style={{
          padding: "5px 11px",
          borderRadius: 5,
          fontSize: 16,
          fontFamily: "inherit",
          fontWeight: active ? 600 : 400,
          color: active ? "#fff" : "rgba(255,255,255,0.6)",
          background: active ? "rgba(255,255,255,0.15)" : "transparent",
          border: "none",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        Settings
        <span
          aria-hidden
          style={{
            fontSize: 10,
            opacity: 0.8,
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform 0.1s",
          }}
        >
          ▾
        </span>
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            minWidth: 180,
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            padding: 6,
            zIndex: 200,
          }}
        >
          {SETTINGS_ITEMS.map(({ href, label }) => {
            const isActive = pathname === href || pathname.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={`${href}${suffix}`}
                role="menuitem"
                style={{
                  display: "block",
                  padding: "8px 12px",
                  borderRadius: 5,
                  fontSize: 15,
                  fontWeight: isActive ? 600 : 400,
                  color: "#1a1f3a",
                  background: isActive ? "rgba(26,31,58,0.08)" : "transparent",
                  textDecoration: "none",
                }}
              >
                {label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
