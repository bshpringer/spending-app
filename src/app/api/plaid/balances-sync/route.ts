import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db.ts";
import { makePlaidItemRepo } from "@/lib/repo/plaidItemRepo.ts";
import { snapshotItemBalances } from "@/lib/plaid/balances.ts";

export const dynamic = "force-dynamic";

/**
 * Refresh balance snapshots for all linked Plaid items (or one specific item).
 * Calls /accounts/get per item and writes a new row to plaid_account_balances.
 * Safe to call any time — does not touch cursors or staging.
 *
 * Body: { itemId?: string }  — omit to refresh all items.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { itemId?: string };
    const db = getDb();
    const itemRepo = makePlaidItemRepo(db);

    const items = body.itemId
      ? [itemRepo.getByItemId(body.itemId)].filter(Boolean)
      : itemRepo.list();

    if (items.length === 0) {
      return NextResponse.json({ ok: false, error: "No linked items found" }, { status: 404 });
    }

    let totalSnapshots = 0;
    const errors: string[] = [];

    for (const item of items) {
      if (!item) continue;
      try {
        const count = await snapshotItemBalances(db, item.itemId);
        totalSnapshots += count;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${item.institutionName ?? item.itemId}: ${msg}`);
      }
    }

    revalidatePath("/dashboard");

    return NextResponse.json({
      ok: true,
      snapshots: totalSnapshots,
      ...(errors.length > 0 ? { errors } : {}),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
