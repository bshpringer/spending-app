"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db.ts";
import { makeMerchantAliasRepo } from "@/lib/repo/merchantAliasRepo.ts";
import { makeMerchantTriageRepo } from "@/lib/repo/merchantTriageRepo.ts";

function revalidateMerchantSurfaces() {
  revalidatePath("/settings/plaid/reconcile-merchants");
  revalidatePath("/settings/plaid/merchant-aliases");
  revalidatePath("/transactions");
  revalidatePath("/trends");
  // canonicalName changes shift merchant aggregation everywhere.
  revalidatePath("/merchants");
  revalidatePath("/merchants/[name]", "page");
  revalidatePath("/categories");
  revalidatePath("/categories/[name]", "page");
}

export interface ConfirmTriageClusterInput {
  canonicalName: string;
  defaultCategory: string | null;
  rocketPatterns: string[];
  plaidPatterns: string[];
}

/**
 * Confirm a triage cluster: register the alias (+ source patterns for both
 * sources) and stamp canonicalName onto every transaction whose merchant key
 * matches one of the patterns — regardless of source. Categories on existing
 * rows are never touched; the alias's defaultCategory only affects future
 * Plaid syncs.
 */
export async function confirmTriageCluster(
  input: ConfirmTriageClusterInput,
): Promise<{ ok: true; updatedRows: number } | { ok: false; error: string }> {
  try {
    const canonical = input.canonicalName.trim();
    if (!canonical) return { ok: false, error: "Canonical name required" };
    const allPatterns = Array.from(new Set([...input.rocketPatterns, ...input.plaidPatterns]));
    if (allPatterns.length === 0) {
      return { ok: false, error: "At least one source pattern required" };
    }

    const db = getDb();
    const aliasRepo = makeMerchantAliasRepo(db);

    let updatedRows = 0;
    const write = db.transaction(() => {
      aliasRepo.create({
        canonicalName: canonical,
        defaultCategory: input.defaultCategory?.trim() || null,
        // User confirmed it by hand — that's as confident as it gets.
        confidence: "high",
        sources: [
          ...input.rocketPatterns.map((p) => ({ sourcePattern: p, source: "rocket" as const })),
          ...input.plaidPatterns.map((p) => ({ sourcePattern: p, source: "plaid" as const })),
        ],
      });
      const placeholders = allPatterns.map(() => "?").join(",");
      const r = db
        .prepare(
          `UPDATE transactions
           SET canonicalName = ?, updatedAt = ?
           WHERE COALESCE(NULLIF(customName, ''), name) IN (${placeholders})`,
        )
        .run(canonical, new Date().toISOString(), ...allPatterns);
      updatedRows = r.changes;
    });
    write();

    revalidateMerchantSurfaces();
    return { ok: true, updatedRows };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function ignoreTriageCluster(
  stem: string,
  label: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!stem.trim()) return { ok: false, error: "stem required" };
    makeMerchantTriageRepo(getDb()).dismiss(stem, label);
    revalidatePath("/settings/plaid/reconcile-merchants");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function unignoreTriageCluster(
  stem: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    makeMerchantTriageRepo(getDb()).undismiss(stem);
    revalidatePath("/settings/plaid/reconcile-merchants");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}
