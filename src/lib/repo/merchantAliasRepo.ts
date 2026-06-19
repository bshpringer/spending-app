import type { Database } from "better-sqlite3";
import type {
  MerchantAlias,
  MerchantAliasConfidence,
  MerchantAliasMatchType,
  MerchantAliasReject,
  MerchantAliasSource,
  MerchantAliasSourceKind,
} from "../types.ts";
import { normalizeMerchantStem } from "../merchantReconcile.ts";

interface AliasRow {
  canonicalName: string;
  defaultCategory: string | null;
  confidence: MerchantAliasConfidence;
  createdAt: string;
  updatedAt: string;
}

interface SourceRow {
  sourcePattern: string;
  source: MerchantAliasSourceKind;
  canonicalName: string;
  matchType: MerchantAliasMatchType;
  createdAt: string;
}

interface RejectRow {
  rocketStem: string;
  plaidStem: string;
  rocketLabel: string;
  plaidLabel: string;
  rejectedAt: string;
}

function rowToAlias(row: AliasRow): MerchantAlias {
  return { ...row };
}

export interface NewAliasInput {
  canonicalName: string;
  defaultCategory: string | null;
  confidence: MerchantAliasConfidence;
  sources: { sourcePattern: string; source: MerchantAliasSourceKind; matchType?: MerchantAliasMatchType }[];
}

export interface AliasUpdateInput {
  defaultCategory?: string | null;
  confidence?: MerchantAliasConfidence;
}

export function makeMerchantAliasRepo(db: Database) {
  const insertAlias = db.prepare(`
    INSERT INTO merchant_alias (canonicalName, defaultCategory, confidence, createdAt, updatedAt)
    VALUES (@canonicalName, @defaultCategory, @confidence, @createdAt, @updatedAt)
    ON CONFLICT(canonicalName) DO UPDATE SET
      defaultCategory = excluded.defaultCategory,
      confidence      = excluded.confidence,
      updatedAt       = excluded.updatedAt
  `);
  const insertSource = db.prepare(`
    INSERT INTO merchant_alias_source
      (sourcePattern, source, canonicalName, matchType, normalizedStem, createdAt)
    VALUES
      (@sourcePattern, @source, @canonicalName, @matchType, @normalizedStem, @createdAt)
    ON CONFLICT(sourcePattern, source) DO UPDATE SET
      canonicalName  = excluded.canonicalName,
      matchType      = excluded.matchType,
      normalizedStem = excluded.normalizedStem
  `);
  const selectAll = db.prepare(`SELECT * FROM merchant_alias ORDER BY canonicalName ASC`);
  const selectByCanonical = db.prepare(
    `SELECT * FROM merchant_alias WHERE canonicalName = ?`,
  );
  const selectSourcesByCanonical = db.prepare(
    `SELECT * FROM merchant_alias_source WHERE canonicalName = ? ORDER BY source, sourcePattern`,
  );
  const selectAllSources = db.prepare(
    `SELECT * FROM merchant_alias_source ORDER BY canonicalName, source, sourcePattern`,
  );
  // Hot path: called for each incoming Plaid txn in the sync route. Matched
  // by normalizedStem (computed via normalizeMerchantStem on the incoming raw
  // name) so ACH-style transactions with per-payment IDs still resolve to
  // their alias. Falls back to exact sourcePattern match if the stem is empty
  // (defensive: should not happen post-backfill, but the column default is '').
  const lookupSourceByStem = db.prepare(
    `SELECT s.*, a.defaultCategory, a.confidence
     FROM merchant_alias_source s
     JOIN merchant_alias a ON a.canonicalName = s.canonicalName
     WHERE s.normalizedStem = ? AND s.source = ?
     LIMIT 1`,
  );
  const updateAlias = db.prepare(`
    UPDATE merchant_alias
    SET defaultCategory = @defaultCategory,
        confidence      = @confidence,
        updatedAt       = @updatedAt
    WHERE canonicalName = @canonicalName
  `);
  const deleteAliasStmt = db.prepare(`DELETE FROM merchant_alias WHERE canonicalName = ?`);
  const deleteSource = db.prepare(
    `DELETE FROM merchant_alias_source WHERE sourcePattern = ? AND source = ?`,
  );

  const insertReject = db.prepare(`
    INSERT OR REPLACE INTO merchant_alias_reject
      (rocketStem, plaidStem, rocketLabel, plaidLabel, rejectedAt)
    VALUES (?, ?, ?, ?, ?)
  `);
  const deleteReject = db.prepare(
    `DELETE FROM merchant_alias_reject WHERE rocketStem = ? AND plaidStem = ?`,
  );
  const selectRejects = db.prepare(
    `SELECT * FROM merchant_alias_reject ORDER BY rejectedAt DESC`,
  );
  const isRejectedStmt = db.prepare(
    `SELECT 1 FROM merchant_alias_reject WHERE rocketStem = ? AND plaidStem = ?`,
  );

  function create(input: NewAliasInput): void {
    const now = new Date().toISOString();
    const tx = db.transaction((i: NewAliasInput) => {
      insertAlias.run({
        canonicalName: i.canonicalName,
        defaultCategory: i.defaultCategory,
        confidence: i.confidence,
        createdAt: now,
        updatedAt: now,
      });
      for (const s of i.sources) {
        insertSource.run({
          sourcePattern: s.sourcePattern,
          source: s.source,
          canonicalName: i.canonicalName,
          matchType: s.matchType ?? "exact",
          normalizedStem: normalizeMerchantStem(s.sourcePattern),
          createdAt: now,
        });
      }
    });
    tx(input);
  }

  function list(): MerchantAlias[] {
    return (selectAll.all() as AliasRow[]).map(rowToAlias);
  }

  function get(canonicalName: string): MerchantAlias | null {
    const row = selectByCanonical.get(canonicalName) as AliasRow | undefined;
    return row ? rowToAlias(row) : null;
  }

  function listSources(canonicalName: string): MerchantAliasSource[] {
    return selectSourcesByCanonical.all(canonicalName) as SourceRow[];
  }

  function listAllSources(): MerchantAliasSource[] {
    return selectAllSources.all() as SourceRow[];
  }

  function lookupBySourcePattern(
    pattern: string,
    source: MerchantAliasSourceKind,
  ): { canonicalName: string; defaultCategory: string | null; confidence: MerchantAliasConfidence } | null {
    const stem = normalizeMerchantStem(pattern);
    if (!stem) return null;
    const row = lookupSourceByStem.get(stem, source) as
      | (SourceRow & { defaultCategory: string | null; confidence: MerchantAliasConfidence })
      | undefined;
    if (!row) return null;
    return {
      canonicalName: row.canonicalName,
      defaultCategory: row.defaultCategory,
      confidence: row.confidence,
    };
  }

  function update(canonicalName: string, patch: AliasUpdateInput): void {
    const existing = get(canonicalName);
    if (!existing) throw new Error(`alias ${canonicalName} not found`);
    updateAlias.run({
      canonicalName,
      defaultCategory: patch.defaultCategory !== undefined ? patch.defaultCategory : existing.defaultCategory,
      confidence: patch.confidence ?? existing.confidence,
      updatedAt: new Date().toISOString(),
    });
  }

  function remove(canonicalName: string): void {
    // ON DELETE CASCADE on merchant_alias_source drops source rows.
    deleteAliasStmt.run(canonicalName);
  }

  function addSource(
    canonicalName: string,
    sourcePattern: string,
    source: MerchantAliasSourceKind,
    matchType: MerchantAliasMatchType = "exact",
  ): void {
    insertSource.run({
      sourcePattern,
      source,
      canonicalName,
      matchType,
      normalizedStem: normalizeMerchantStem(sourcePattern),
      createdAt: new Date().toISOString(),
    });
  }

  function removeSource(sourcePattern: string, source: MerchantAliasSourceKind): void {
    deleteSource.run(sourcePattern, source);
  }

  function reject(input: {
    rocketStem: string;
    plaidStem: string;
    rocketLabel: string;
    plaidLabel: string;
  }): void {
    insertReject.run(
      input.rocketStem,
      input.plaidStem,
      input.rocketLabel,
      input.plaidLabel,
      new Date().toISOString(),
    );
  }

  function unreject(rocketStem: string, plaidStem: string): void {
    deleteReject.run(rocketStem, plaidStem);
  }

  function listRejects(): MerchantAliasReject[] {
    return selectRejects.all() as RejectRow[];
  }

  function isRejected(rocketStem: string, plaidStem: string): boolean {
    return isRejectedStmt.get(rocketStem, plaidStem) !== undefined;
  }

  return {
    create,
    list,
    get,
    listSources,
    listAllSources,
    lookupBySourcePattern,
    update,
    remove,
    addSource,
    removeSource,
    reject,
    unreject,
    listRejects,
    isRejected,
  };
}

export type MerchantAliasRepo = ReturnType<typeof makeMerchantAliasRepo>;
