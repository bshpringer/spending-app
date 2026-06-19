import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db.ts";
import { makePlaidItemRepo } from "@/lib/repo/plaidItemRepo.ts";
import { makePlaidStagingRepo, type NewStagingInput } from "@/lib/repo/plaidStagingRepo.ts";
import { makePlaidStagingRemovalsRepo } from "@/lib/repo/plaidStagingRemovalsRepo.ts";
import { makeAccountRepo } from "@/lib/repo/accountRepo.ts";
import { makeMerchantAliasRepo } from "@/lib/repo/merchantAliasRepo.ts";
import { pullHistoricalWindow } from "@/lib/plaid/referencePull.ts";

export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Historical backfill. Pulls a user-chosen date window via /transactions/get
 * (NOT /transactions/sync — the item cursor is not touched) and writes the
 * results into `plaid_staging` with mode='commit' so they flow through the
 * normal review screen. Fuzzy duplicate scan against `transactions` catches
 * cross-source (CSV ↔ Plaid) and cross-pull (Plaid ↔ Plaid) overlap; rows
 * already imported via /sync are flagged via exact plaidTransactionId match.
 *
 * Refuses if a batch is already pending review — same 409 guard as /sync.
 * The cursor stays where it is; committing this batch promotes the rows but
 * doesn't move the sync bookmark.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      itemId?: string;
      from?: string;
      to?: string;
      plaidAccountIds?: string[];
    };
    if (!body.itemId) {
      return NextResponse.json({ ok: false, error: "Missing itemId" }, { status: 400 });
    }
    if (!body.from || !ISO_DATE.test(body.from) || !body.to || !ISO_DATE.test(body.to)) {
      return NextResponse.json(
        { ok: false, error: "Both From and To dates are required (YYYY-MM-DD)." },
        { status: 400 },
      );
    }
    if (body.from > body.to) {
      return NextResponse.json(
        { ok: false, error: "From date must be on or before To date." },
        { status: 400 },
      );
    }

    const db = getDb();
    const itemRepo = makePlaidItemRepo(db);
    const stagingRepo = makePlaidStagingRepo(db);
    const removalsRepo = makePlaidStagingRemovalsRepo(db);
    const accountRepo = makeAccountRepo(db);
    const aliasRepo = makeMerchantAliasRepo(db);

    const item = itemRepo.getByItemId(body.itemId);
    const accessToken = itemRepo.getAccessToken(body.itemId);
    if (!item || !accessToken) {
      return NextResponse.json({ ok: false, error: "Item not found" }, { status: 404 });
    }

    const existingStaged = stagingRepo.listByItem(body.itemId);
    const existingRemovals = removalsRepo.listByItem(body.itemId);
    if (existingStaged.length > 0 || existingRemovals.length > 0) {
      const parts: string[] = [];
      if (existingStaged.length > 0) parts.push(`${existingStaged.length} adds`);
      if (existingRemovals.length > 0) parts.push(`${existingRemovals.length} removals`);
      return NextResponse.json(
        {
          ok: false,
          error: `Batch already staged (${parts.join(", ")}). Review or discard before importing history.`,
        },
        { status: 409 },
      );
    }

    const links = itemRepo.accountLinksByItem(body.itemId);
    if (links.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "This bank hasn't been reconciled yet — pick which local accounts each Plaid account maps to before importing history.",
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

    // Validate the optional sub-account scope: every id must belong to this
    // Item. Silently dropping unknown ids could mask a stale UI; reject loudly.
    const requestedScope = Array.isArray(body.plaidAccountIds) ? body.plaidAccountIds : [];
    const linkedIds = new Set(links.map((l) => l.plaidAccountId));
    const invalidScope = requestedScope.filter((id) => !linkedIds.has(id));
    if (invalidScope.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: `Unknown plaidAccountId(s) for this item: ${invalidScope.join(", ")}`,
        },
        { status: 400 },
      );
    }

    const pulled = await pullHistoricalWindow({
      accessToken,
      startDate: body.from,
      endDate: body.to,
      accountIds: requestedScope.length > 0 ? requestedScope : undefined,
    });

    // Exact-id match against `transactions`: any historical row Plaid is
    // re-emitting that we've already imported via /sync should auto-flag as
    // a merge (against itself, effectively a no-op the user can confirm).
    const exactIdStmt = db.prepare(
      `SELECT id, date, name, customName, amount FROM transactions WHERE plaidTransactionId = ?`,
    );
    // Fuzzy match: same accountId + exact amount + ±3 day window. Catches
    // CSV-imported overlap and any non-Plaid duplicate.
    const fuzzyStmt = db.prepare(`
      SELECT id, date, name, customName, amount
      FROM transactions
      WHERE accountId = ?
        AND amount = ?
        AND date BETWEEN date(?, '-3 days') AND date(?, '+3 days')
      ORDER BY ABS(julianday(date) - julianday(?)) ASC
      LIMIT 1
    `);

    const stagingInputs: NewStagingInput[] = [];
    let flaggedCount = 0;
    let skippedNoAccount = 0;

    for (const r of pulled) {
      const accountId = accountIdByPlaidAccountId.get(r.plaidAccountId);
      if (!accountId) {
        skippedNoAccount++;
        continue;
      }
      const profileId = profileIdByAccountId.get(accountId) ?? null;

      let proposedAction: "keep" | "skip" | "merge" = "keep";
      let matchedTransactionId: string | null = null;
      let flagReason: string | null = null;

      const exact = exactIdStmt.get(r.plaidTransactionId) as
        | { id: string; date: string; name: string; customName: string | null; amount: number }
        | undefined;
      if (exact) {
        // Exact plaidTransactionId match: same Plaid row we already imported.
        // Merge is the right default — it's a true id collision, the local
        // row already has the right plaidTransactionId set.
        const merchant = exact.customName ?? exact.name;
        flagReason = `already imported via Sync as "${merchant}" on ${exact.date}`;
        matchedTransactionId = exact.id;
        proposedAction = "merge";
        flaggedCount++;
      } else {
        const fuzzy = fuzzyStmt.get(accountId, r.amount, r.date, r.date, r.date) as
          | { id: string; date: string; name: string; customName: string | null; amount: number }
          | undefined;
        if (fuzzy) {
          // Fuzzy match: same account + amount + ±3 days but different (or
          // missing) plaidTransactionId. Default to "skip" — user is past the
          // bulk-backfill phase and forward-going fuzzy hits are almost
          // always noise we want dropped, not merged into existing rows.
          const merchant = fuzzy.customName ?? fuzzy.name;
          const dayDelta = daysBetween(r.date, fuzzy.date);
          const deltaLabel = dayDelta === 0 ? "same day" : `±${dayDelta}d`;
          flagReason = `matches "${merchant}" ${formatMoney(fuzzy.amount)} on ${fuzzy.date} (${deltaLabel})`;
          matchedTransactionId = fuzzy.id;
          proposedAction = "skip";
          flaggedCount++;
        }
      }

      const aliasHit = aliasRepo.lookupBySourcePattern(r.name, "plaid");
      let canonicalName: string | null = null;
      let category = r.category;
      let prefilledFromMediumAlias = false;
      if (aliasHit && aliasHit.confidence !== "low") {
        canonicalName = aliasHit.canonicalName;
        if (aliasHit.defaultCategory) category = aliasHit.defaultCategory;
        if (aliasHit.confidence === "medium") prefilledFromMediumAlias = true;
      }

      stagingInputs.push({
        itemId: body.itemId,
        plaidTransactionId: r.plaidTransactionId,
        accountId,
        profileId,
        dedupeKey: `plaid:${r.plaidTransactionId}`,
        date: r.date,
        originalDate: r.originalDate,
        name: r.name,
        customName: null,
        canonicalName,
        amount: r.amount,
        csvAmount: r.csvAmount,
        description: r.description,
        category,
        note: "",
        tags: [],
        proposedAction,
        matchedTransactionId,
        flagReason,
        prefilledFromMediumAlias,
        plaidRaw: r.plaidRaw,
        plaidRawFull: r.plaidRawFull,
      });
    }

    const stagedCount = stagingRepo.insertBatch(stagingInputs);

    revalidatePath("/settings/plaid");
    revalidatePath(`/settings/plaid/review/${body.itemId}`);

    return NextResponse.json({
      ok: true,
      pulled: pulled.length,
      stagedCount,
      flaggedCount,
      skippedNoAccount,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: errorMessage(err) }, { status: 500 });
  }
}

function daysBetween(a: string, b: string): number {
  const ms = Math.abs(new Date(a).getTime() - new Date(b).getTime());
  return Math.round(ms / 86_400_000);
}

function formatMoney(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return "Unknown error";
}
