import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db.ts";
import { makePlaidItemRepo } from "@/lib/repo/plaidItemRepo.ts";
import { makePlaidStagingRepo, type NewStagingInput } from "@/lib/repo/plaidStagingRepo.ts";
import { makeAccountRepo } from "@/lib/repo/accountRepo.ts";
import { pullReferenceWindow } from "@/lib/plaid/referencePull.ts";

export const dynamic = "force-dynamic";

/**
 * Phase 2 reference pull. Pulls a historical window via /transactions/get
 * (NOT /transactions/sync — the item cursor is not touched) and stores the
 * results in `plaid_staging` with mode='reference'. The reconciliation wizard
 * reads these rows; the normal commit flow ignores them.
 *
 * Re-running for the same itemId is safe: existing reference rows for that
 * item are cleared first.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { itemId?: string; months?: number };
    if (!body.itemId) {
      return NextResponse.json({ ok: false, error: "Missing itemId" }, { status: 400 });
    }
    const months = body.months === 12 ? 12 : 6;

    const db = getDb();
    const itemRepo = makePlaidItemRepo(db);
    const stagingRepo = makePlaidStagingRepo(db);
    const accountRepo = makeAccountRepo(db);

    const item = itemRepo.getByItemId(body.itemId);
    const accessToken = itemRepo.getAccessToken(body.itemId);
    if (!item || !accessToken) {
      return NextResponse.json({ ok: false, error: "Item not found" }, { status: 404 });
    }

    const links = itemRepo.accountLinksByItem(body.itemId);
    if (links.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "Reconcile this bank's accounts before pulling reference data.",
        },
        { status: 400 },
      );
    }

    const accountIdByPlaidAccountId = new Map<string, string>();
    const profileIdByAccountId = new Map<string, string>();
    for (const link of links) {
      const localAccount = accountRepo.findById(link.accountId);
      if (!localAccount) continue;
      accountIdByPlaidAccountId.set(link.plaidAccountId, localAccount.id);
      profileIdByAccountId.set(localAccount.id, localAccount.profileId);
    }

    const reference = await pullReferenceWindow({ accessToken, months });

    // Replace any prior reference rows for this item.
    stagingRepo.clearReference(body.itemId);

    const inputs: NewStagingInput[] = [];
    for (const r of reference) {
      const accountId = accountIdByPlaidAccountId.get(r.plaidAccountId) ?? null;
      const profileId = accountId ? profileIdByAccountId.get(accountId) ?? null : null;
      inputs.push({
        itemId: body.itemId,
        plaidTransactionId: r.plaidTransactionId,
        accountId,
        profileId,
        // dedupeKey isn't used for reference rows but the column is NOT NULL;
        // scope it so it cannot collide with a real commit-mode row.
        dedupeKey: `plaid-ref:${r.plaidTransactionId}`,
        date: r.date,
        originalDate: r.originalDate,
        name: r.name,
        customName: null,
        canonicalName: null,
        amount: r.amount,
        csvAmount: r.csvAmount,
        description: r.description,
        category: r.category,
        note: "",
        tags: [],
        proposedAction: "keep",
        matchedTransactionId: null,
        flagReason: null,
        mode: "reference",
        prefilledFromMediumAlias: false,
      });
    }

    const inserted = stagingRepo.insertBatch(inputs);
    revalidatePath("/settings/plaid");
    revalidatePath("/settings/plaid/reconcile-merchants");

    return NextResponse.json({
      ok: true,
      pulled: reference.length,
      inserted,
      months,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: errorMessage(err) },
      { status: 500 },
    );
  }
}

/**
 * Discard reference data for an item (or all items when itemId is omitted).
 */
export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    const itemId = url.searchParams.get("itemId") ?? undefined;
    const db = getDb();
    const stagingRepo = makePlaidStagingRepo(db);
    stagingRepo.clearReference(itemId);
    revalidatePath("/settings/plaid");
    revalidatePath("/settings/plaid/reconcile-merchants");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: errorMessage(err) }, { status: 500 });
  }
}

function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return "Unknown error";
}
