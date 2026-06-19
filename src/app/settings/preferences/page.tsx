import { getDb } from "@/lib/db";
import { makePrefsRepo } from "@/lib/repo/prefsRepo.ts";
import { PreferencesClient } from "./PreferencesClient.tsx";

export const dynamic = "force-dynamic";

export default async function PreferencesSettingsPage() {
  const db = getDb();
  const prefs = makePrefsRepo(db).getAll();

  // The true earliest transaction in the DB (ignoring the floor) — shown as a
  // hint so the user knows how far their data actually goes back.
  const earliestRow = db
    .prepare(
      `SELECT MIN(COALESCE(NULLIF(originalDate, ''), date)) AS earliest FROM transactions`,
    )
    .get() as { earliest: string | null } | undefined;
  const earliestDate = earliestRow?.earliest ?? null;

  return (
    <main style={{ padding: "2rem", maxWidth: 760, margin: "0 auto" }}>
      <h1 style={{ fontSize: "1.625rem", margin: "0.5rem 0 1rem" }}>Preferences</h1>
      <p style={{ opacity: 0.7, fontSize: "1.025rem", marginBottom: "1.75rem" }}>
        App-wide defaults. These apply across every page until you change them.
      </p>

      <PreferencesClient prefs={prefs} earliestDate={earliestDate} />
    </main>
  );
}
