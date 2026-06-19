import type { Database } from "better-sqlite3";
import type { NewStagingInput } from "../repo/plaidStagingRepo.ts";
import type { NewRemovalInput } from "../repo/plaidStagingRemovalsRepo.ts";
import type { TransactionUserOverrides } from "../types.ts";

/**
 * Two-pass pending→posted linker.
 *
 * **Pass 1 (exact `pending_transaction_id`):** For each posted add carrying
 * `pending_transaction_id`, find the matching pending row in (a) another add
 * in this batch or (b) the committed `transactions` table, inherit its user
 * edits onto the posted, and silently retire the pending.
 *
 * **Pass 2 (fuzzy cross-reference):** Detects the case where a removal and a
 * fuzzy-duplicate addition BOTH target the same committed `transactions.id`,
 * but the ID-based linker in Pass 1 missed them (because Plaid assigned the
 * posted row a different `pending_transaction_id` than the one we stored for
 * the pending). Without this pass, the defaults are delete (removal) + skip
 * (duplicate) — committing both erases the charge entirely.
 *
 * When Pass 2 finds a match it promotes the addition to a pending→posted
 * replacement (inherits edits, defaults to "keep", sets
 * `replacesTransactionId`) and splices the removal out of `removalInputs`
 * so it doesn't also try to delete the local row.
 */
export function resolvePendingToPosted(
  db: Database,
  stagingInputs: NewStagingInput[],
  removalInputs: NewRemovalInput[]
) {
  let autoResolvedCount = 0;

  const priorTxnStmt = db.prepare(`
    SELECT id, customName, canonicalName, category, note, userOverrides, date
    FROM transactions
    WHERE plaidTransactionId = ?
  `);
  const txByIdStmt = db.prepare(`
    SELECT id, customName, canonicalName, category, note, userOverrides, date
    FROM transactions
    WHERE id = ?
  `);
  const selectTagsForTx = db.prepare(`SELECT tagId FROM transaction_tags WHERE transactionId = ?`);

  const removalByPlaidId = new Map(removalInputs.map((r) => [r.plaidTransactionId, r]));
  const batchAddsByPlaidId = new Map(stagingInputs.map((s) => [s.plaidTransactionId, s]));

  // Track which staging inputs were already resolved in Pass 1 so Pass 2
  // doesn't re-process them.
  const resolvedInputs = new Set<NewStagingInput>();

  // ── Pass 1: exact pending_transaction_id match ──────────────────────

  for (const input of stagingInputs) {
    if (!input.plaidRaw) continue;
    if (input.plaidRaw.pending) continue;
    const pendingId = input.plaidRaw.pendingTransactionId;
    if (!pendingId) continue;

    let matchedPending: {
      location: "transactions" | "batch";
      id: string;
      date: string;
      customName: string | null;
      canonicalName: string | null;
      category: string;
      note: string;
      tags: string[];
      overrides?: TransactionUserOverrides;
    } | null = null;

    const txMatch = priorTxnStmt.get(pendingId) as {
      id: string;
      date: string;
      customName: string | null;
      canonicalName: string | null;
      category: string;
      note: string;
      userOverrides: string;
    } | undefined;
    if (txMatch) {
      const tags = (selectTagsForTx.all(txMatch.id) as { tagId: string }[]).map((r) => r.tagId);
      matchedPending = {
        location: "transactions",
        id: txMatch.id,
        date: txMatch.date,
        customName: txMatch.customName,
        canonicalName: txMatch.canonicalName,
        category: txMatch.category,
        note: txMatch.note,
        tags,
        overrides: JSON.parse(txMatch.userOverrides || "{}") as TransactionUserOverrides,
      };
    }

    if (!matchedPending) {
      const batchAddMatch = batchAddsByPlaidId.get(pendingId);
      if (batchAddMatch) {
        matchedPending = {
          location: "batch",
          id: batchAddMatch.plaidTransactionId,
          date: batchAddMatch.date,
          customName: batchAddMatch.customName ?? null,
          canonicalName: batchAddMatch.canonicalName ?? null,
          category: batchAddMatch.category ?? "",
          note: batchAddMatch.note ?? "",
          tags: batchAddMatch.tags ?? [],
        };
      }
    }

    if (!matchedPending) continue;

    autoResolvedCount++;
    resolvedInputs.add(input);

    inheritEdits(input, matchedPending);

    if (matchedPending.location === "batch") {
      const pendingInput = batchAddsByPlaidId.get(matchedPending.id);
      if (pendingInput) pendingInput.proposedAction = "skip";
      input.proposedAction = "keep";
    } else {
      input.proposedAction = "keep";
      input.replacesTransactionId = matchedPending.id;
      input.flagReason = `auto-resolved pending charge → replaces existing local row`;
    }

    // If Plaid also `removed` this pending row, splice that removal out — same
    // as Pass 2. When the posted row carries `replacesTransactionId`, commit-
    // batch already hard-deletes the old pending atomically with the insert
    // (and re-points its refund/duplicate FKs), so a separate "Removed by
    // Plaid" row would be a redundant second delete AND a second, visually
    // disconnected representation of the same pending→posted transition. The
    // consolidated pending→posted row (with its "→ replaces local pending …"
    // sub-line) is the single source of truth. Only do this when we actually
    // set `replacesTransactionId` (the committed-pending case); a batch-local
    // pending has no committed row and therefore no removal.
    if (matchedPending.location === "transactions") {
      const removal = removalByPlaidId.get(pendingId);
      if (removal) {
        const removalIdx = removalInputs.indexOf(removal);
        if (removalIdx >= 0) removalInputs.splice(removalIdx, 1);
      }
    }
  }

  // ── Pass 2: fuzzy cross-reference (removal + duplicate → same local row) ─

  // When Plaid's posted row carries a `pending_transaction_id` that doesn't
  // match the `plaidTransactionId` we stored for the pending, Pass 1 can't
  // pair them. In that case the sync route independently produces:
  //   • A removal targeting the local row (via the stored pending Plaid id)
  //   • A fuzzy-duplicate addition also targeting the same local row
  //     (via accountId + amount + ±3d)
  // Committing both defaults (delete + skip) erases the charge. We detect
  // this overlap and fold the pair into a pending→posted replacement.

  if (removalInputs.length > 0) {
    // Index removals by the local transactions.id they target.
    const removalByLocalTxId = new Map<string, NewRemovalInput>();
    for (const r of removalInputs) {
      removalByLocalTxId.set(r.matchedTransactionId, r);
    }

    for (const input of stagingInputs) {
      // Skip rows already resolved in Pass 1 or that are pending rows
      // themselves or that aren't fuzzy-matched duplicates.
      if (resolvedInputs.has(input)) continue;
      if (!input.matchedTransactionId) continue;
      // Only convert rows that the fuzzy scan matched (these have flagReason
      // set). Auto-resolved rows from Pass 1 already have replacesTransactionId.
      if (input.replacesTransactionId) continue;

      const removal = removalByLocalTxId.get(input.matchedTransactionId);
      if (!removal) continue;

      // Found the collision: this addition's fuzzy-matched local row is the
      // same row a removal wants to delete. Treat as pending→posted.

      // Look up the local row to inherit edits.
      const localRow = txByIdStmt.get(input.matchedTransactionId) as {
        id: string;
        date: string;
        customName: string | null;
        canonicalName: string | null;
        category: string;
        note: string;
        userOverrides: string;
      } | undefined;

      if (localRow) {
        const tags = (selectTagsForTx.all(localRow.id) as { tagId: string }[]).map((r) => r.tagId);
        inheritEdits(input, {
          date: localRow.date,
          customName: localRow.customName,
          canonicalName: localRow.canonicalName,
          category: localRow.category,
          note: localRow.note,
          tags,
          overrides: JSON.parse(localRow.userOverrides || "{}") as TransactionUserOverrides,
        });
      }

      input.proposedAction = "keep";
      input.replacesTransactionId = input.matchedTransactionId;
      input.flagReason =
        `auto-resolved pending→posted (fuzzy): removal + duplicate both target same local row`;

      // Splice the removal out — commit-batch's replacesTransactionId path
      // already handles deleting the old row atomically with the insert.
      const removalIdx = removalInputs.indexOf(removal);
      if (removalIdx >= 0) removalInputs.splice(removalIdx, 1);

      autoResolvedCount++;
      resolvedInputs.add(input);
    }
  }

  return autoResolvedCount;
}

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Inherit user edits from a matched pending row onto the incoming posted row.
 * The pending's `date` is the truer swipe day — Plaid often massages
 * `authorized_date` on the posted by a day or two. We overwrite the posted's
 * `originalDate` (the canonical/aggregation date) but leave the posted's
 * `date` (settled day, audit trail) untouched.
 */
function inheritEdits(
  input: NewStagingInput,
  matched: {
    date: string;
    customName: string | null;
    canonicalName: string | null;
    category: string;
    note: string;
    tags: string[];
    overrides?: TransactionUserOverrides;
  }
) {
  if (matched.date) input.originalDate = matched.date;
  if (matched.customName) input.customName = matched.customName;
  if (matched.canonicalName) input.canonicalName = matched.canonicalName;
  if (matched.category) input.category = matched.category;
  if (matched.note) input.note = matched.note;
  if (matched.tags.length > 0) input.tags = matched.tags;
  if (matched.overrides) input.inheritedOverrides = matched.overrides;
}
