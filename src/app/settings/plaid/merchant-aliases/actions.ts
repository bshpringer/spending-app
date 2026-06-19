"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db.ts";
import { makeMerchantAliasRepo } from "@/lib/repo/merchantAliasRepo.ts";

export async function createAlias(input: {
  canonicalName: string;
  defaultCategory: string | null;
  sourcePattern?: string;
  source?: "rocket" | "plaid";
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const canonical = input.canonicalName.trim();
    if (!canonical) return { ok: false, error: "Canonical name required" };
    const db = getDb();
    const aliasRepo = makeMerchantAliasRepo(db);
    const pattern = input.sourcePattern?.trim();
    const tx = db.transaction(() => {
      aliasRepo.create({
        canonicalName: canonical,
        defaultCategory: input.defaultCategory?.trim() || null,
        confidence: "high",
        sources: pattern ? [{ sourcePattern: pattern, source: input.source ?? "rocket" }] : [],
      });
      if (pattern) {
        db.prepare(
          `UPDATE transactions
           SET canonicalName = ?, updatedAt = ?
           WHERE COALESCE(NULLIF(customName, ''), name) = ?`,
        ).run(canonical, new Date().toISOString(), pattern);
      }
    });
    tx();
    revalidatePath("/settings/plaid/merchant-aliases");
    revalidatePath("/settings/plaid/reconcile-merchants");
    revalidatePath("/transactions");
    revalidatePath("/trends");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function deleteAlias(canonicalName: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const db = getDb();
    const aliasRepo = makeMerchantAliasRepo(db);
    aliasRepo.remove(canonicalName);
    revalidatePath("/settings/plaid/merchant-aliases");
    revalidatePath("/settings/plaid/reconcile-merchants");
    revalidatePath("/transactions");
    revalidatePath("/trends");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function updateAliasFields(
  canonicalName: string,
  defaultCategory: string | null,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const db = getDb();
    const aliasRepo = makeMerchantAliasRepo(db);
    aliasRepo.update(canonicalName, { defaultCategory: defaultCategory?.trim() || null });
    revalidatePath("/settings/plaid/merchant-aliases");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function removeSource(
  sourcePattern: string,
  source: "rocket" | "plaid",
): Promise<{ ok: boolean; error?: string }> {
  try {
    const db = getDb();
    const aliasRepo = makeMerchantAliasRepo(db);
    aliasRepo.removeSource(sourcePattern, source);
    revalidatePath("/settings/plaid/merchant-aliases");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function addSource(
  canonicalName: string,
  sourcePattern: string,
  source: "rocket" | "plaid",
): Promise<{ ok: boolean; error?: string }> {
  try {
    const pat = sourcePattern.trim();
    if (!pat) return { ok: false, error: "sourcePattern required" };
    const db = getDb();
    const aliasRepo = makeMerchantAliasRepo(db);
    
    const tx = db.transaction(() => {
      aliasRepo.addSource(canonicalName, pat, source);
      
      db.prepare(
        `UPDATE transactions
         SET canonicalName = ?,
             updatedAt = ?
         WHERE COALESCE(NULLIF(customName, ''), name) = ?`
      ).run(canonicalName, new Date().toISOString(), pat);
    });
    tx();
    
    revalidatePath("/settings/plaid/merchant-aliases");
    revalidatePath("/transactions");
    revalidatePath("/trends");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function unrejectPair(
  rocketStem: string,
  plaidStem: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const db = getDb();
    const aliasRepo = makeMerchantAliasRepo(db);
    aliasRepo.unreject(rocketStem, plaidStem);
    revalidatePath("/settings/plaid/merchant-aliases");
    revalidatePath("/settings/plaid/reconcile-merchants");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}
