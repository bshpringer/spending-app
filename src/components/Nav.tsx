import { Suspense } from "react";
import { accessibleProfiles } from "@/lib/auth";
import { NavLinks } from "./NavLinks.tsx";
import { ProfileSwitcher } from "./ProfileSwitcher.tsx";
import { ObscureToggle } from "./ObscureToggle.tsx";

export default function Nav() {
  const profiles = accessibleProfiles().map((p) => ({
    id: p.id,
    displayName: p.displayName,
    color: p.color,
  }));

  return (
    <nav
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "0 20px",
        height: 54,
        background: "#1a1f3a",
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 100,
      }}
    >
      <Suspense fallback={<div style={{ flex: 1 }} />}>
        <NavLinks />
      </Suspense>
      <Suspense fallback={<div />}>
        <ProfileSwitcher profiles={profiles} />
      </Suspense>
      <ObscureToggle />
    </nav>
  );
}
