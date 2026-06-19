import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db.ts";
import { getPlaidClient } from "@/lib/plaid/client.ts";
import { makePlaidItemRepo } from "@/lib/repo/plaidItemRepo.ts";
import { makePlaidStagingRepo, type NewStagingInput } from "@/lib/repo/plaidStagingRepo.ts";
import { makePlaidStagingRemovalsRepo, type NewRemovalInput } from "@/lib/repo/plaidStagingRemovalsRepo.ts";
import { makeAccountRepo } from "@/lib/repo/accountRepo.ts";
import { makeMerchantAliasRepo } from "@/lib/repo/merchantAliasRepo.ts";
import { pullTransactionsSync, type PlaidAccountContext } from "@/lib/plaid/sync.ts";
import { snapshotItemBalances } from "@/lib/plaid/balances.ts";
import { resolvePendingToPosted } from "@/lib/plaid/pendingPostedLinker.ts";

export const dynamic = "force-dynamic";

/**
 * Phase 1 sync: pulls from Plaid using the STORED cursor, runs a fuzzy
 * duplicate scan against `transactions`, and writes results into the
 * `plaid_staging` table for human review. The Plaid cursor itself is NOT
 * advanced — next_cursor is parked in plaid_items.pendingCursor and only
 * promoted to `cursor` when the user confirms the batch.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { itemId?: string; from?: string; to?: string };
    if (!body.itemId) {
      return NextResponse.json(
        { ok: false, error: "Missing itemId" },
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
      return NextResponse.json(
        { ok: false, error: "Item not found" },
        { status: 404 },
      );
    }

    // Guard: don't stage on top of an existing pending batch — the user must
    // commit or discard before pulling again. The /settings/plaid UI already
    // disables Sync in this state but the server enforces it too.
    const existingStaged = stagingRepo.listByItem(body.itemId);
    const existingRemovals = removalsRepo.listByItem(body.itemId);
    if (existingStaged.length > 0 || existingRemovals.length > 0) {
      const parts: string[] = [];
      if (existingStaged.length > 0) parts.push(`${existingStaged.length} adds`);
      if (existingRemovals.length > 0) parts.push(`${existingRemovals.length} removals`);
      return NextResponse.json(
        {
          ok: false,
          error: `Batch already staged (${parts.join(", ")}). Review or discard before syncing again.`,
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
            "This bank hasn't been reconciled yet — pick which local accounts each Plaid account maps to before syncing.",
        },
        { status: 400 },
      );
    }

    const client = getPlaidClient();
    const accountsResp = await client.accountsGet({ access_token: accessToken });
    const plaidById = new Map(
      accountsResp.data.accounts.map((a) => [a.account_id, a] as const),
    );

    const contextByPlaidAccountId = new Map<string, PlaidAccountContext>();
    const accountIdByNaturalKey = new Map<string, string>();
    const profileIdByAccountId = new Map<string, string>();

    for (const link of links) {
      const plaid = plaidById.get(link.plaidAccountId);
      const localAccount = accountRepo.findById(link.accountId);
      if (!plaid || !localAccount) continue;
      const institutionName = localAccount.institutionName;
      const last4 = localAccount.accountNumberLast4 || plaid.mask || "";
      contextByPlaidAccountId.set(link.plaidAccountId, {
        institutionName,
        accountNumberLast4: last4,
      });
      const mapperNaturalKey = `${slugifyForKey(institutionName)}::${last4}`;
      accountIdByNaturalKey.set(mapperNaturalKey, localAccount.id);
      profileIdByAccountId.set(localAccount.id, localAccount.profileId);
    }

    const syncResult = await pullTransactionsSync({
      accessToken,
      cursor: item.cursor,
      contextByPlaidAccountId,
    });
    const dateFrom = body.from || undefined;
    const dateTo = body.to || undefined;

    // Fuzzy duplicate scan: same accountId + exact amount + ±3 day window.
    // Cheap to do row-by-row given staging batches are typically small.
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
    for (const parsed of syncResult.added) {
      const accountId = accountIdByNaturalKey.get(parsed.accountNaturalKey);
      if (!accountId) continue; // shouldn't happen — mapper builds the key from the same context
      const profileId = profileIdByAccountId.get(accountId) ?? null;

      const match = fuzzyStmt.get(accountId, parsed.amount, parsed.date, parsed.date, parsed.date) as
        | { id: string; date: string; name: string; customName: string | null; amount: number }
        | undefined;

      let proposedAction: "keep" | "skip" | "merge" = "keep";
      let matchedTransactionId: string | null = null;
      let flagReason: string | null = null;
      if (match) {
        const merchant = match.customName ?? match.name;
        const dayDelta = daysBetween(parsed.date, match.date);
        const deltaLabel = dayDelta === 0 ? "same day" : `±${dayDelta}d`;
        flagReason = `matches "${merchant}" ${formatMoney(match.amount)} on ${match.date} (${deltaLabel})`;
        matchedTransactionId = match.id;
        // Default to "skip" (drop the incoming, leave the existing row alone).
        // User is past the bulk-backfill phase; almost all duplicate matches
        // going forward are noise. "merge" is still available per-row in the
        // review UI when the user wants to backfill plaidTransactionId.
        proposedAction = "skip";
        flaggedCount++;
      }

      // Phase 2: alias pre-fill. High-confidence aliases fill canonicalName +
      // category silently; medium aliases fill but flag the row so the review
      // UI can surface a "?" indicator.
      const aliasHit = aliasRepo.lookupBySourcePattern(parsed.name, "plaid");
      let canonicalName: string | null = null;
      let category = parsed.category;
      let prefilledFromMediumAlias = false;
      if (aliasHit && aliasHit.confidence !== "low") {
        canonicalName = aliasHit.canonicalName;
        if (aliasHit.defaultCategory) category = aliasHit.defaultCategory;
        if (aliasHit.confidence === "medium") prefilledFromMediumAlias = true;
      }

      stagingInputs.push({
        itemId: body.itemId,
        plaidTransactionId: parsed.plaidTransactionId ?? "",
        accountId,
        profileId,
        dedupeKey: parsed.dedupeKey,
        date: parsed.date,
        originalDate: parsed.originalDate,
        name: parsed.name,
        customName: null,
        canonicalName,
        amount: parsed.amount,
        csvAmount: parsed.csvAmount,
        description: parsed.description,
        category,
        note: parsed.note,
        tags: parsed.tags,
        proposedAction,
        matchedTransactionId,
        flagReason,
        prefilledFromMediumAlias,
        plaidRaw: parsed.plaidRaw ?? null,
        plaidRawFull: parsed.plaidRawFull ?? null,
      });
    }

    // Removals (Plaid says a previously-delivered txn is gone — typically a
    // pending row that was replaced by a posted row with a new id). Look up
    // each removed id in `transactions`; if it matches a local row, stage it
    // for delete/ignore review. Orphan removals are dropped silently.
    //
    // For each removal, look for a likely pending→posted replacement (same
    // accountId, exact amount, ±5 days) across THREE places, in order:
    //   1. This batch's `stagingInputs` (replacement arrived in the same sync)
    //   2. Prior staged-but-not-yet-committed rows in `plaid_staging` for the
    //      same item (replacement arrived in a previous sync that's still
    //      pending review)
    //   3. Already-committed rows in `transactions` (replacement was committed
    //      in a prior sync round-trip — the common daily-sync case)
    // Excludes self-match on `plaidTransactionId` so the row being removed
    // doesn't pair with itself.
    const removalInputs: NewRemovalInput[] = [];
    if (syncResult.removedPlaidTransactionIds.length > 0) {
      const lookup = db.prepare(
        `SELECT id, accountId, date, name, customName, amount FROM transactions WHERE plaidTransactionId = ?`,
      );
      // Index this batch's adds by (accountId, amount) for O(1) candidate lookup.
      const addedByAccountAmount = new Map<string, typeof stagingInputs>();
      for (const s of stagingInputs) {
        const key = `${s.accountId}::${s.amount}`;
        const bucket = addedByAccountAmount.get(key);
        if (bucket) bucket.push(s);
        else addedByAccountAmount.set(key, [s]);
      }

      // Same-item commit-mode staging rows already on disk (review queue).
      const priorStagingStmt = db.prepare(`
        SELECT date, name, customName, canonicalName
        FROM plaid_staging
        WHERE itemId = ? AND mode = 'commit'
          AND accountId = ? AND amount = ?
          AND date BETWEEN date(?, '-5 days') AND date(?, '+5 days')
          AND plaidTransactionId != ?
        ORDER BY ABS(julianday(date) - julianday(?)) ASC
        LIMIT 1
      `);

      // Already-committed transactions with a different plaidTransactionId.
      const priorTxnStmt = db.prepare(`
        SELECT date, name, customName, canonicalName
        FROM transactions
        WHERE accountId = ? AND amount = ?
          AND date BETWEEN date(?, '-5 days') AND date(?, '+5 days')
          AND (plaidTransactionId IS NULL OR plaidTransactionId != ?)
          AND id != ?
        ORDER BY ABS(julianday(date) - julianday(?)) ASC
        LIMIT 1
      `);

      for (const plaidId of syncResult.removedPlaidTransactionIds) {
        const row = lookup.get(plaidId) as
          | {
              id: string;
              accountId: string;
              date: string;
              name: string;
              customName: string | null;
              amount: number;
            }
          | undefined;
        if (!row) continue;

        let replacementHint: string | null = null;

        // 1. This batch's adds.
        const batchCandidates = addedByAccountAmount.get(`${row.accountId}::${row.amount}`) ?? [];
        for (const c of batchCandidates) {
          if (Math.abs(daysBetween(c.date, row.date)) <= 5) {
            const merchant = c.canonicalName ?? c.customName ?? c.name;
            replacementHint = `likely replaced by "${merchant}" on ${c.date} (this batch)`;
            break;
          }
        }

        // 2. Prior staging rows for the same item.
        if (!replacementHint) {
          const staged = priorStagingStmt.get(
            body.itemId,
            row.accountId,
            row.amount,
            row.date,
            row.date,
            plaidId,
            row.date,
          ) as { date: string; name: string; customName: string | null; canonicalName: string | null } | undefined;
          if (staged) {
            const merchant = staged.canonicalName ?? staged.customName ?? staged.name;
            replacementHint = `likely replaced by "${merchant}" on ${staged.date} (awaiting review)`;
          }
        }

        // 3. Committed transactions.
        if (!replacementHint) {
          const prior = priorTxnStmt.get(
            row.accountId,
            row.amount,
            row.date,
            row.date,
            plaidId,
            row.id,
            row.date,
          ) as { date: string; name: string; customName: string | null; canonicalName: string | null } | undefined;
          if (prior) {
            const merchant = prior.canonicalName ?? prior.customName ?? prior.name;
            replacementHint = `likely replaced by "${merchant}" on ${prior.date} (already in your transactions)`;
          }
        }

        removalInputs.push({
          itemId: body.itemId,
          plaidTransactionId: plaidId,
          matchedTransactionId: row.id,
          matchedDate: row.date,
          matchedName: row.customName ?? row.name,
          matchedAmount: row.amount,
          replacementHint,
        });
      }
    }

    const autoResolvedCount = resolvePendingToPosted(db, stagingInputs, removalInputs);

    // Apply the user's [from, to] window AFTER the linker has matched across
    // the full add set, so an out-of-window posted row can still resolve an
    // in-window pending. Auto-resolved rows (replacesTransactionId set) stay
    // in regardless of window — the user needs to see/commit them so the
    // local pending row gets cleaned up.
    const stagingToInsert = stagingInputs.filter((s) => {
      if (s.replacesTransactionId) return true;
      const aggDate = s.originalDate || s.date;
      if (dateFrom && aggDate < dateFrom) return false;
      if (dateTo && aggDate > dateTo) return false;
      return true;
    });

    const stagedCount = stagingRepo.insertBatch(stagingToInsert);
    const removalCount = removalsRepo.insertBatch(removalInputs);

    // Park the next_cursor — only promoted to `cursor` on commit.
    itemRepo.setPendingCursor(body.itemId, syncResult.nextCursor);

    // Opportunistic balance snapshot — fire-and-forget, doesn't block the sync response.
    snapshotItemBalances(db, body.itemId).catch(() => {});

    revalidatePath("/settings/plaid");
    revalidatePath("/dashboard");

    return NextResponse.json({
      ok: true,
      stagedCount,
      flaggedCount,
      removalCount,
      autoResolvedCount,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: errorMessage(err) },
      { status: 500 },
    );
  }
}

function slugifyForKey(displayName: string): string {
  return displayName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
