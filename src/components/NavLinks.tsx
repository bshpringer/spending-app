"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { SettingsMenu } from "./SettingsMenu.tsx";
import { useProfile } from "./ProfileContext.tsx";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/trends", label: "Trends" },
  { href: "/transactions", label: "Transactions" },
  { href: "/categories", label: "Categories" },
  { href: "/merchants", label: "Merchants" },
  { href: "/recurring", label: "Recurring" },
];

export function NavLinks() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { activeProfile } = useProfile();
  // URL param takes precedence (deep-link), else use the persistent context.
  const profile = searchParams.get("profile") ?? (activeProfile !== "all" ? activeProfile : null);
  const suffix = profile ? `?profile=${encodeURIComponent(profile)}` : "";
  return (
    <>
      <Link
        href={`/dashboard${suffix}`}
        style={{
          fontWeight: 700,
          fontSize: 18,
          color: "#fff",
          textDecoration: "none",
          marginRight: 20,
          letterSpacing: "-0.3px",
        }}
      >
        Budget
      </Link>
      {LINKS.map(({ href, label }) => {
        const active = pathname === href || pathname.startsWith(href + "/");
        return (
          <Link
            key={href}
            href={`${href}${suffix}`}
            style={{
              padding: "5px 11px",
              borderRadius: 5,
              fontSize: 16,
              fontWeight: active ? 600 : 400,
              color: active ? "#fff" : "rgba(255,255,255,0.6)",
              background: active ? "rgba(255,255,255,0.15)" : "transparent",
              textDecoration: "none",
              transition: "background 0.1s, color 0.1s",
            }}
          >
            {label}
          </Link>
        );
      })}
      <SettingsMenu />
    </>
  );
}

