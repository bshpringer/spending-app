"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db.ts";
import { makePrefsRepo, type AppPreferences } from "@/lib/repo/prefsRepo.ts";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Persist app-wide preferences. Validates the start date shape (empty string
 * clears the floor). Revalidates the whole app since the data-start floor and
 * the hide-excluded default affect nearly every page.
 */
export async function updateAppPreferences(
  patch: Partial<AppPreferences>,
): Promise<{ ok: boolean; error?: string }> {
  if (patch.dataStartDate !== undefined) {
    const v = patch.dataStartDate.trim();
    if (v !== "" && !ISO_DATE.test(v)) {
      return { ok: false, error: "Start date must be YYYY-MM-DD or empty." };
    }
    patch = { ...patch, dataStartDate: v };
  }

  const db = getDb();
  makePrefsRepo(db).update(patch);

  // The floor + hide-excluded default change reads across the whole app.
  revalidatePath("/", "layout");
  return { ok: true };
}
