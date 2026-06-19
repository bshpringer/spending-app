import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db.ts";
import { getPlaidClient } from "@/lib/plaid/client.ts";
import { makePlaidItemRepo } from "@/lib/repo/plaidItemRepo.ts";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { itemId?: string };
    if (!body.itemId) {
      return NextResponse.json(
        { ok: false, error: "Missing itemId" },
        { status: 400 },
      );
    }
    const db = getDb();
    const repo = makePlaidItemRepo(db);
    const accessToken = repo.getAccessToken(body.itemId);
    if (!accessToken) {
      return NextResponse.json(
        { ok: false, error: "Item not found" },
        { status: 404 },
      );
    }
    // Tell Plaid to revoke the access token. Swallow errors here — if Plaid
    // fails we still want to drop the local row so the user can move on.
    try {
      const client = getPlaidClient();
      await client.itemRemove({ access_token: accessToken });
    } catch {
      // intentionally ignored
    }
    repo.delete(body.itemId);
    revalidatePath("/settings/plaid");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: errorMessage(err) },
      { status: 500 },
    );
  }
}

function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return "Unknown error";
}
