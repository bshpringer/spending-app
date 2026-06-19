import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db.ts";
import { makePlaidStagingRepo, type StagingUpdateInput } from "@/lib/repo/plaidStagingRepo.ts";
import { makePlaidStagingRemovalsRepo } from "@/lib/repo/plaidStagingRemovalsRepo.ts";
import type { PlaidStagingAction, PlaidStagingRemovalAction } from "@/lib/types.ts";

export const dynamic = "force-dynamic";

interface Body {
  // Either stagingId (for an addition row) OR plaidTransactionId (for a removal row).
  stagingId?: string;
  plaidTransactionId?: string;
  itemId?: string;
  date?: string;
  originalDate?: string;
  amount?: number;
  customName?: string | null;
  canonicalName?: string | null;
  category?: string;
  note?: string;
  tags?: string[];
  proposedAction?: PlaidStagingAction | PlaidStagingRemovalAction;
  matchedTransactionId?: string | null;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    if (!body.itemId || (!body.stagingId && !body.plaidTransactionId)) {
      return NextResponse.json(
        { ok: false, error: "Missing itemId, and either stagingId or plaidTransactionId" },
        { status: 400 },
      );
    }
    const db = getDb();

    // Removal-row update path: only proposedAction is meaningful (delete|ignore).
    if (body.plaidTransactionId && !body.stagingId) {
      const removalsRepo = makePlaidStagingRemovalsRepo(db);
      const action = body.proposedAction;
      if (action !== "delete" && action !== "ignore") {
        return NextResponse.json(
          { ok: false, error: "proposedAction must be 'delete' or 'ignore' for removals" },
          { status: 400 },
        );
      }
      removalsRepo.setAction(body.itemId, body.plaidTransactionId, action);
      revalidatePath(`/settings/plaid/review/${body.itemId}`);
      return NextResponse.json({ ok: true });
    }

    const stagingRepo = makePlaidStagingRepo(db);
    const existing = stagingRepo.getById(body.stagingId!);
    if (!existing || existing.itemId !== body.itemId) {
      return NextResponse.json(
        { ok: false, error: "Staging row not found" },
        { status: 404 },
      );
    }

    const update: StagingUpdateInput = {};
    if (body.date !== undefined) update.date = body.date;
    if (body.originalDate !== undefined) update.originalDate = body.originalDate;
    if (body.amount !== undefined) update.amount = body.amount;
    if ("customName" in body) update.customName = body.customName;
    if ("canonicalName" in body) update.canonicalName = body.canonicalName;
    if (body.category !== undefined) update.category = body.category;
    if (body.note !== undefined) update.note = body.note;
    if (body.tags !== undefined) update.tags = body.tags;
    if (body.proposedAction !== undefined) {
      if (body.proposedAction !== "keep" && body.proposedAction !== "skip" && body.proposedAction !== "merge") {
        return NextResponse.json(
          { ok: false, error: "proposedAction must be 'keep', 'skip', or 'merge' for additions" },
          { status: 400 },
        );
      }
      update.proposedAction = body.proposedAction;
    }
    if ("matchedTransactionId" in body) update.matchedTransactionId = body.matchedTransactionId;

    stagingRepo.update(body.stagingId!, update);

    revalidatePath(`/settings/plaid/review/${body.itemId}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
