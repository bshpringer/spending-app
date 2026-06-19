"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db.ts";
import { makePlaidItemRepo } from "@/lib/repo/plaidItemRepo.ts";

export async function reorderBanks(orderedItemIds: string[]): Promise<void> {
  const db = getDb();
  const repo = makePlaidItemRepo(db);
  repo.reorder(orderedItemIds);
  revalidatePath("/settings/plaid");
  revalidatePath("/dashboard");
}
