import type { Database } from "better-sqlite3";

/**
 * Apply a confirmed /reconcile match: enrich the surviving CSV/Rocket row with
 * the matched Plaid row's rich fields, in place.
 *
 * Policy (resolved product questions):
 *  • Q1 enrich-empty-only — Plaid fills Rocket's BLANKS (category, canonicalName)
 *    but never clobbers hand-tuned values unless the caller opts in per field.
 *    `plaidTransactionId` / `plaidRaw` / `plaidRawFull` are pure provenance and
 *    are always stamped (nothing user-authored to lose).
 *  • Q2 keep Rocket, drop Plaid — the CSV row is the survivor and stays put, so
 *    its existing FK dependents (refunds, dupe reviews) don't move.
 *  • Q3 de-dupe — only when the Plaid twin was ALREADY committed as its own
 *    `transactions` row (rare; the staging fuzzy scan normally prevents this).
 *    Then we hard-delete that row and re-point ITS FK dependents onto the
 *    survivor. The delete happens BEFORE stamping `plaidTransactionId` so the
 *    partial-UNIQUE index on `transactions(plaidTransactionId)` can't collide.
 *
 * Caller is expected to wrap this in a db.transaction() together with the
 * `reconciliation_reviews` write (markReconciled).
 *
 * NOTE on durability: enrichment writes the `category` / `canonicalName`
 * COLUMNS directly (what every read path uses), not `userOverrides`. This is a
 * one-time historical migration; a subsequent CSV re-import of the same old row
 * could in theory re-blank the category. Acceptable for the migration; revisit
 * if old-CSV re-imports become routine.
 */

export interface ReconcileEnrichment {
  /** Plaid transaction_id — stamped onto the survivor for future auto-dedupe. */
  plaidTransactionId: string;
  /** Curated plaidRaw JSON (already serialized) — or null. */
  plaidRaw: string | null;
  /** Verbatim plaidRawFull JSON (already serialized) — or null. */
  plaidRawFull: string | null;
  /** Plaid's category candidate (fills a blank survivor category). */
  category?: string | null;
  /** Plaid's canonical-name candidate (fills a blank survivor canonicalName). */
  canonicalName?: string | null;
}

export interface ApplyReconcileOptions {
  /** Per-pair opt-in: overwrite the survivor's category even if non-blank. */
  overwriteCategory?: boolean;
  /** Per-pair opt-in: overwrite the survivor's canonicalName even if non-blank. */
  overwriteCanonicalName?: boolean;
}

export interface ApplyReconcileResult {
  /** Which survivor fields were actually written. */
  enrichedFields: string[];
  /** True if a previously-committed Plaid twin row was hard-deleted (Q3). */
  deletedExistingPlaidRow: boolean;
  /** Count of FK dependent rows re-pointed off the deleted twin onto the survivor. */
  repointedFkCount: number;
}

function isBlankCategory(c: string | null | undefined): boolean {
  const v = (c ?? "").trim();
  return v === "" || v.toLowerCase() === "uncategorized";
}

function isBlankCanonical(c: string | null | undefined): boolean {
  return (c ?? "").trim() === "";
}

export function applyReconciliation(
  db: Database,
  csvTransactionId: string,
  enrich: ReconcileEnrichment,
  opts: ApplyReconcileOptions = {},
): ApplyReconcileResult {
  const survivor = db
    .prepare(
      `SELECT id, category, canonicalName, plaidTransactionId
         FROM transactions WHERE id = ?`,
    )
    .get(csvTransactionId) as
    | { id: string; category: string; canonicalName: string | null; plaidTransactionId: string | null }
    | undefined;
  if (!survivor) {
    throw new Error(`applyReconciliation: survivor transaction ${csvTransactionId} not found`);
  }

  let deletedExistingPlaidRow = false;
  let repointedFkCount = 0;

  // ── Q3: if the Plaid twin is ALREADY a committed row, drop it + re-point ──
  const committedTwin = db
    .prepare(
      `SELECT id FROM transactions WHERE plaidTransactionId = ? AND id != ?`,
    )
    .get(enrich.plaidTransactionId, csvTransactionId) as { id: string } | undefined;

  if (committedTwin) {
    repointedFkCount = repointFkDependents(db, committedTwin.id, csvTransactionId);
    db.prepare(`DELETE FROM transactions WHERE id = ?`).run(committedTwin.id);
    deletedExistingPlaidRow = true;
  }

  // ── Build the enrich-empty-only UPDATE on the survivor ──────────────────
  const sets: string[] = [];
  const params: unknown[] = [];
  const enrichedFields: string[] = [];

  // Provenance: always stamped, but only when the survivor has no link yet (a
  // pre-existing plaidTransactionId means it's already reconciled — don't risk
  // the UNIQUE index, and don't overwrite a real prior link).
  if (!survivor.plaidTransactionId) {
    sets.push("plaidTransactionId = ?");
    params.push(enrich.plaidTransactionId);
    enrichedFields.push("plaidTransactionId");
  }
  if (enrich.plaidRaw !== undefined) {
    sets.push("plaidRaw = ?");
    params.push(enrich.plaidRaw);
    enrichedFields.push("plaidRaw");
  }
  if (enrich.plaidRawFull !== undefined) {
    sets.push("plaidRawFull = ?");
    params.push(enrich.plaidRawFull);
    enrichedFields.push("plaidRawFull");
  }

  // Category — fill blank, or overwrite on opt-in.
  const cat = (enrich.category ?? "").trim();
  if (cat && (opts.overwriteCategory || isBlankCategory(survivor.category))) {
    sets.push("category = ?");
    params.push(cat);
    enrichedFields.push("category");
  }

  // canonicalName — fill blank, or overwrite on opt-in.
  const canon = (enrich.canonicalName ?? "").trim();
  if (canon && (opts.overwriteCanonicalName || isBlankCanonical(survivor.canonicalName))) {
    sets.push("canonicalName = ?");
    params.push(canon);
    enrichedFields.push("canonicalName");
  }

  if (sets.length > 0) {
    sets.push("updatedAt = ?");
    params.push(new Date().toISOString());
    params.push(csvTransactionId);
    db.prepare(`UPDATE transactions SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  }

  return { enrichedFields, deletedExistingPlaidRow, repointedFkCount };
}

/**
 * Re-point FK dependents from a row about to be deleted (`fromId`) onto the
 * survivor (`toId`), across the cross-reference tables that hold transaction
 * ids: refund_matches, duplicate_reviews, reconciliation_reviews. Mirrors the
 * capture→delete→re-insert pattern in commit-batch; INSERT OR IGNORE absorbs
 * any pair that would collide with one the survivor already has. Returns the
 * number of dependent rows carried over.
 *
 * transaction_tags are intentionally NOT carried — Q2 keeps the Rocket row's
 * own tags; the deleted Plaid row's tags cascade away.
 */
function repointFkDependents(db: Database, fromId: string, toId: string): number {
  let count = 0;

  // refund_matches — fromId may be on either side of a pair.
  const refundsAsExpense = db
    .prepare(`SELECT refundId, status, createdAt FROM refund_matches WHERE expenseId = ?`)
    .all(fromId) as { refundId: string; status: string; createdAt: string }[];
  const refundsAsRefund = db
    .prepare(`SELECT expenseId, status, createdAt FROM refund_matches WHERE refundId = ?`)
    .all(fromId) as { expenseId: string; status: string; createdAt: string }[];
  const insertRefund = db.prepare(
    `INSERT OR IGNORE INTO refund_matches (expenseId, refundId, status, createdAt) VALUES (?, ?, ?, ?)`,
  );
  for (const r of refundsAsExpense) {
    // Skip a pair that would become a self-pair after the merge.
    if (r.refundId === toId) continue;
    count += insertRefund.run(toId, r.refundId, r.status, r.createdAt).changes;
  }
  for (const r of refundsAsRefund) {
    if (r.expenseId === toId) continue;
    count += insertRefund.run(r.expenseId, toId, r.status, r.createdAt).changes;
  }

  // duplicate_reviews — lex-ordered pair (txAId < txBId).
  const dupes = db
    .prepare(`SELECT txAId, txBId, status, createdAt FROM duplicate_reviews WHERE txAId = ? OR txBId = ?`)
    .all(fromId, fromId) as { txAId: string; txBId: string; status: string; createdAt: string }[];
  const insertDupe = db.prepare(
    `INSERT OR IGNORE INTO duplicate_reviews (txAId, txBId, status, createdAt) VALUES (?, ?, ?, ?)`,
  );
  for (const d of dupes) {
    const other = d.txAId === fromId ? d.txBId : d.txAId;
    if (other === toId) continue;
    const [a, b] = toId < other ? [toId, other] : [other, toId];
    count += insertDupe.run(a, b, d.status, d.createdAt).changes;
  }

  // reconciliation_reviews — survivor side only (csvTransactionId FK). Unusual
  // (a Plaid row acting as a reconcile survivor), but re-point for completeness.
  const reviews = db
    .prepare(`SELECT plaidTransactionId, status, createdAt FROM reconciliation_reviews WHERE csvTransactionId = ?`)
    .all(fromId) as { plaidTransactionId: string; status: string; createdAt: string }[];
  const insertReview = db.prepare(
    `INSERT OR IGNORE INTO reconciliation_reviews (csvTransactionId, plaidTransactionId, status, createdAt) VALUES (?, ?, ?, ?)`,
  );
  for (const rv of reviews) {
    count += insertReview.run(toId, rv.plaidTransactionId, rv.status, rv.createdAt).changes;
  }

  // The cascade delete of `fromId` removes the stale dependent rows.
  return count;
}
