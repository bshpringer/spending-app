import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db.ts";
import { makePlaidItemRepo } from "@/lib/repo/plaidItemRepo.ts";
import { makePlaidStagingRepo } from "@/lib/repo/plaidStagingRepo.ts";
import { makePlaidStagingRemovalsRepo } from "@/lib/repo/plaidStagingRemovalsRepo.ts";
import { makeAccountRepo } from "@/lib/repo/accountRepo.ts";
import { makeTransactionRepo } from "@/lib/repo/transactionRepo.ts";
import { makeRuleRepo } from "@/lib/repo/ruleRepo.ts";
import type { ParsedTransaction, TransactionUserOverrides } from "@/lib/types.ts";
import { accountNaturalKey } from "@/lib/csv-import.ts";
import { previewRulesForStagedRow } from "@/app/settings/plaid/review/[itemId]/stagingRulePreview.ts";

export const dynamic = "force-dynamic";

/**
 * Commits a staged Plaid batch into `transactions`.
 *
 * For each staged row:
 *   keep  → upsert into `transactions` via the usual bulkUpsert path
 *   skip  → drop silently
 *   merge → don't insert; backfill the staged plaidTransactionId onto the
 *           matched existing transactions row so future syncs auto-dedupe
 *           on `selectByPlaidId` instead of re-flagging the same pair.
 *
 * Then the previously-parked next_cursor is promoted to the live `cursor`,
 * staging rows are wiped, and category backfill runs.
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
    const accountRepo = makeAccountRepo(db);
    const transactionRepo = makeTransactionRepo(db);
    const rules = makeRuleRepo(db).list();

    const item = itemRepo.getByItemId(body.itemId);
    if (!item) {
      return NextResponse.json({ ok: false, error: "Item not found" }, { status: 404 });
    }
    // Historical-import batches park no pendingCursor (the /transactions/get
    // path doesn't produce one). The presence of staged rows is the real "is
    // there something to commit" signal, not pendingCursor — guard on staging
    // emptiness below.
    const staged = stagingRepo.listByItem(body.itemId);
    const removals = removalsRepo.listByItem(body.itemId);
    if (staged.length === 0 && removals.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No staged rows for this item." },
        { status: 400 },
      );
    }

    // Build natural-key → accountId map for the rows we're committing.
    // The staging row already knows its resolved accountId, so we just need
    // to ensure the mapper's naturalKey points back to it.
    const accountIdByNaturalKey = new Map<string, string>();
    const profileIdByAccountId = new Map<string, string>();
    const accountCache = new Map<string, ReturnType<typeof accountRepo.findById>>();
    for (const row of staged) {
      if (!row.accountId) continue;
      if (!accountCache.has(row.accountId)) {
        accountCache.set(row.accountId, accountRepo.findById(row.accountId));
      }
      const acct = accountCache.get(row.accountId);
      if (!acct) continue;
      const naturalKey = accountNaturalKey(acct.institutionName, acct.accountNumberLast4);
      accountIdByNaturalKey.set(naturalKey, acct.id);
      profileIdByAccountId.set(acct.id, acct.profileId);
    }

    const updatePlaidId = db.prepare(
      `UPDATE transactions SET plaidTransactionId = ?, updatedAt = ? WHERE id = ? AND plaidTransactionId IS NULL`,
    );
    const deleteTxn = db.prepare(`DELETE FROM transactions WHERE id = ?`);
    const selectRefundsForExpense = db.prepare(
      `SELECT refundId, status, createdAt FROM refund_matches WHERE expenseId = ?`,
    );
    const selectRefundsForRefund = db.prepare(
      `SELECT expenseId, status, createdAt FROM refund_matches WHERE refundId = ?`,
    );
    const insertRefundMatch = db.prepare(
      `INSERT OR IGNORE INTO refund_matches (expenseId, refundId, status, createdAt) VALUES (?, ?, ?, ?)`,
    );
    const selectDupePairsForTx = db.prepare(
      `SELECT txAId, txBId, status, createdAt FROM duplicate_reviews WHERE txAId = ? OR txBId = ?`,
    );
    const insertDupeReview = db.prepare(
      `INSERT OR IGNORE INTO duplicate_reviews (txAId, txBId, status, createdAt) VALUES (?, ?, ?, ?)`,
    );
    const selectTxByDedupeKey = db.prepare(`SELECT id FROM transactions WHERE dedupeKey = ?`);
    const txExists = db.prepare(`SELECT 1 FROM transactions WHERE id = ?`);

    interface CarriedFKs {
      dedupeKey: string;
      replacedOldId: string;
      refundsAsExpense: { refundId: string; status: string; createdAt: string }[];
      refundsAsRefund: { expenseId: string; status: string; createdAt: string }[];
      dupePairs: { otherId: string; status: string; createdAt: string }[];
    }
    const carriedFKsByDedupeKey = new Map<string, CarriedFKs>();

    const parsedKeep: ParsedTransaction[] = [];
    const overridesByDedupeKey = new Map<string, TransactionUserOverrides>();
    const profileIdByDedupeKey = new Map<string, string>();

    let mergeCount = 0;
    let skipCount = 0;
    let mergeBackfillSkipped = 0;
    let deletedCount = 0;
    let ignoredRemovalCount = 0;

    const txn = db.transaction(() => {
      for (const row of staged) {
        if (row.proposedAction === "skip") {
          skipCount++;
          continue;
        }
        if (row.proposedAction === "merge") {
          if (row.matchedTransactionId && row.plaidTransactionId) {
            const info = updatePlaidId.run(
              row.plaidTransactionId,
              new Date().toISOString(),
              row.matchedTransactionId,
            );
            if (info.changes === 0) mergeBackfillSkipped++;
          }
          mergeCount++;
          continue;
        }

        // keep — build a ParsedTransaction the bulkUpsert can chew on.
        if (!row.accountId) continue;
        const acct = accountCache.get(row.accountId);
        if (!acct) continue;
        const naturalKey = accountNaturalKey(acct.institutionName, acct.accountNumberLast4);

        // Fold rule effects into the outgoing values so disk reflects what the
        // user saw in the review preview. Mirrors the bulk-edit precedent
        // (user-driven category/name/tag changes write through). The read-time
        // overlay in aggregations.ts is left in place — it's idempotent against
        // rows that already carry the rule's values.
        const preview = previewRulesForStagedRow(rules, {
          accountId: row.accountId,
          profileId: row.profileId,
          date: row.date,
          originalDate: row.originalDate,
          name: row.name,
          customName: row.customName,
          canonicalName: row.canonicalName,
          amount: row.amount,
          description: row.description,
          category: row.category,
          note: row.note,
          tags: row.tags,
        });
        const effects = preview?.effects;
        const effectiveCategory = effects?.category ?? row.category;
        const effectiveCanonical =
          effects?.canonicalName ?? row.canonicalName;
        const effectiveTags = (() => {
          if (!effects?.addTags && !effects?.removeTags) return row.tags;
          const removed = new Set(effects.removeTags ?? []);
          const merged = row.tags.filter((t) => !removed.has(t));
          for (const t of effects.addTags ?? []) {
            if (!merged.includes(t)) merged.push(t);
          }
          return merged;
        })();

        parsedKeep.push({
          dedupeKey: row.dedupeKey,
          accountNaturalKey: naturalKey,
          date: row.date,
          originalDate: row.originalDate,
          name: row.name,
          amount: row.amount,
          csvAmount: row.csvAmount,
          description: row.description,
          category: effectiveCategory,
          note: row.note,
          ignoredFrom: "",
          taxDeductible: false,
          tags: effectiveTags,
          plaidTransactionId: row.plaidTransactionId || undefined,
          canonicalName: effectiveCanonical,
          plaidRaw: row.plaidRaw,
          plaidRawFull: row.plaidRawFull,
        });

        if (row.replacesTransactionId) {
          // Capture FK dependents (refund_matches, duplicate_reviews) before
          // the cascade delete wipes them, so we can re-point to the new
          // posted row's id after bulkUpsert. The pending row's tags are
          // already inherited onto the staging row via the linker, so the
          // bulkUpsert path re-creates them on the new row.
          const refundsAsExpense = selectRefundsForExpense.all(row.replacesTransactionId) as {
            refundId: string;
            status: string;
            createdAt: string;
          }[];
          const refundsAsRefund = selectRefundsForRefund.all(row.replacesTransactionId) as {
            expenseId: string;
            status: string;
            createdAt: string;
          }[];
          const dupePairsRaw = selectDupePairsForTx.all(
            row.replacesTransactionId,
            row.replacesTransactionId,
          ) as { txAId: string; txBId: string; status: string; createdAt: string }[];
          const dupePairs = dupePairsRaw.map((p) => ({
            otherId: p.txAId === row.replacesTransactionId ? p.txBId : p.txAId,
            status: p.status,
            createdAt: p.createdAt,
          }));
          carriedFKsByDedupeKey.set(row.dedupeKey, {
            dedupeKey: row.dedupeKey,
            replacedOldId: row.replacesTransactionId,
            refundsAsExpense,
            refundsAsRefund,
            dupePairs,
          });

          const info = deleteTxn.run(row.replacesTransactionId);
          if (info.changes > 0) deletedCount++;
        }

        // Carry forward edits from the matched pending (set by the linker)
        // plus any customName the staging row already had.
        const overrides: TransactionUserOverrides = { ...(row.inheritedOverrides ?? {}) };
        if (row.customName) overrides.customName = row.customName;
        // Rule overlay → folded into userOverrides so /transactions ledger sees
        // them. customName from a rule wins over the empty staged value but
        // does NOT clobber a hand-edited customName already on the row.
        if (effects?.customName && !overrides.customName) {
          overrides.customName = effects.customName;
        }
        if (effects?.excluded) overrides.excluded = true;
        if (effects?.oneTime) overrides.oneTime = true;
        if (effects?.category) overrides.category = effects.category;
        if (Object.keys(overrides).length > 0) {
          overridesByDedupeKey.set(row.dedupeKey, overrides);
        }
        if (row.profileId) {
          profileIdByDedupeKey.set(row.dedupeKey, row.profileId);
        }
      }

      const upsertResult = transactionRepo.bulkUpsert(
        parsedKeep,
        accountIdByNaturalKey,
        profileIdByAccountId,
        null,
        {
          source: "plaid",
          overridesByDedupeKey,
          profileIdByDedupeKey,
        },
      );

      // Re-point captured FK dependents to the freshly-inserted posted rows.
      // Look up the new id by dedupeKey (unique). Duplicate-review pairs are
      // normalized lex-ordered to match the table's pair convention.
      //
      // The COUNTERPART of a captured pair may itself have been replaced in this
      // same batch (its old row was deleted at line ~228). Map any such old id to
      // its freshly-inserted new id, and skip re-pointing entirely if the
      // counterpart no longer exists (e.g. a removal target) — otherwise we'd
      // INSERT a row referencing a deleted transaction → FOREIGN KEY failure.
      const newIdByReplacedOldId = new Map<string, string>();
      for (const carried of carriedFKsByDedupeKey.values()) {
        const nr = selectTxByDedupeKey.get(carried.dedupeKey) as { id: string } | undefined;
        if (nr) newIdByReplacedOldId.set(carried.replacedOldId, nr.id);
      }
      // Resolve a captured counterpart id to a still-live transaction id, or null.
      const liveCounterpartId = (oldId: string): string | null => {
        const mapped = newIdByReplacedOldId.get(oldId) ?? oldId;
        return txExists.get(mapped) ? mapped : null;
      };

      for (const [dedupeKey, carried] of carriedFKsByDedupeKey) {
        const newRow = selectTxByDedupeKey.get(dedupeKey) as { id: string } | undefined;
        if (!newRow) continue;
        const newId = newRow.id;
        for (const r of carried.refundsAsExpense) {
          const other = liveCounterpartId(r.refundId);
          if (other) insertRefundMatch.run(newId, other, r.status, r.createdAt);
        }
        for (const r of carried.refundsAsRefund) {
          const other = liveCounterpartId(r.expenseId);
          if (other) insertRefundMatch.run(other, newId, r.status, r.createdAt);
        }
        for (const p of carried.dupePairs) {
          const other = liveCounterpartId(p.otherId);
          if (!other) continue;
          const [a, b] = newId < other ? [newId, other] : [other, newId];
          insertDupeReview.run(a, b, p.status, p.createdAt);
        }
      }

      // Removals: 'delete' nukes the matched local row; 'ignore' leaves it.
      for (const r of removals) {
        if (r.proposedAction === "delete") {
          const info = deleteTxn.run(r.matchedTransactionId);
          if (info.changes > 0) deletedCount++;
        } else {
          ignoredRemovalCount++;
        }
      }

      // Promote the parked cursor + wipe staging atomically with the inserts.
      itemRepo.commitPendingCursor(body.itemId!);
      stagingRepo.deleteBatch(body.itemId!);
      removalsRepo.deleteBatch(body.itemId!);

      return upsertResult;
    });

    const upsertResult = txn();

    // Backfill any new category strings so the /categories page picks them up.
    db.exec(`
      INSERT OR IGNORE INTO categories (displayName, classification, createdAt)
      SELECT DISTINCT t.category, 'expense', datetime('now')
      FROM transactions t
      LEFT JOIN deleted_categories d ON d.displayName = t.category
      WHERE t.category != '' AND d.displayName IS NULL
    `);

    revalidatePath("/settings/plaid");
    revalidatePath(`/settings/plaid/review/${body.itemId}`);
    revalidatePath("/transactions");
    revalidatePath("/trends");
    revalidatePath("/categories");

    return NextResponse.json({
      ok: true,
      added: upsertResult.newCount,
      matched: upsertResult.matchedCount,
      merged: mergeCount,
      skipped: skipCount,
      mergeBackfillSkipped,
      deleted: deletedCount,
      ignoredRemovals: ignoredRemovalCount,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
