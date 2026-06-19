import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db.ts";
import { makePlaidItemRepo } from "@/lib/repo/plaidItemRepo.ts";
import { makePlaidStagingRepo } from "@/lib/repo/plaidStagingRepo.ts";
import { makePlaidStagingRemovalsRepo } from "@/lib/repo/plaidStagingRemovalsRepo.ts";

export const dynamic = "force-dynamic";

/**
 * Drops all staged rows for an item and clears pendingCursor. The stored
 * `cursor` is untouched, so the next sync re-pulls the same Plaid window.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { itemId?: string };
    if (!body.itemId) {
      return NextResponse.json({ ok: false, error: "Missing itemId" }, { status: 400 });
    }
    const db = getDb();
    const itemRepo = makePlaidItemRepo(db);
    const stagingRepo = makePlaidStagingRepo(db);
    const removalsRepo = makePlaidStagingRemovalsRepo(db);

    if (!itemRepo.getByItemId(body.itemId)) {
      return NextResponse.json({ ok: false, error: "Item not found" }, { status: 404 });
    }

    stagingRepo.deleteBatch(body.itemId);
    removalsRepo.deleteBatch(body.itemId);
    itemRepo.clearPendingCursor(body.itemId);

    revalidatePath("/settings/plaid");
    revalidatePath(`/settings/plaid/review/${body.itemId}`);

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
