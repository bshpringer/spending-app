import Link from "next/link";
import { getDb } from "@/lib/db";
import { makeProfileRepo } from "@/lib/repo/profileRepo";
import { DEFAULT_PROFILE_ID } from "@/lib/constants.ts";
import { ProfilesClient } from "./ProfilesClient.tsx";

export const dynamic = "force-dynamic";

export default async function ProfilesSettingsPage() {
  const db = getDb();
  const profileRepo = makeProfileRepo(db);
  const profiles = profileRepo.list();

  // Per-profile transaction counts (informational only; helps user judge what
  // they'd be archiving).
  const counts = new Map<string, number>(
    (db.prepare(`SELECT profileId, COUNT(*) AS c FROM transactions GROUP BY profileId`).all() as { profileId: string | null; c: number }[])
      .map((r) => [r.profileId ?? DEFAULT_PROFILE_ID, r.c]),
  );

  return (
    <main style={{ padding: "2rem", maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ fontSize: "1.625rem", margin: "0.5rem 0 1rem" }}>Profiles</h1>
      <p style={{ opacity: 0.7, fontSize: "1.025rem", marginBottom: "1.5rem" }}>
        Profiles silo transactions per person or per household account. Change which
        profile an account uses on the{" "}
        <Link href="/settings/accounts" style={{ textDecoration: "underline" }}>Accounts page</Link>.
      </p>

      <ProfilesClient
        profiles={profiles.map((p) => ({
          id: p.id,
          displayName: p.displayName,
          color: p.color,
          isShared: p.isShared,
          count: counts.get(p.id) ?? 0,
        }))}
      />
    </main>
  );
}
