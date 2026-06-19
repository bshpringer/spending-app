import type { Database } from "better-sqlite3";

/**
 * Autocomplete suggestion lists for the staging review name inputs.
 * - `canonical`: every established canonical identity (merchant_alias rows +
 *   any canonicalName already set on a transaction) — what the Canonical name
 *   box searches against.
 * - `custom`: distinct custom names the user has already used — what the Custom
 *   name box searches against.
 */
export function getNameSuggestions(db: Database): {
  canonical: string[];
  custom: string[];
  /**
   * Lowercased canonical name → the custom names historically used on
   * transactions carrying that canonical name (most-used first). Lets the
   * review page float custom names tied to the current canonical to the top of
   * the Custom name dropdown.
   */
  customByCanonical: Record<string, string[]>;
} {
  const canonical = (
    db
      .prepare(
        `SELECT v FROM (
           SELECT DISTINCT canonicalName AS v FROM transactions
             WHERE canonicalName IS NOT NULL AND canonicalName != ''
           UNION
           SELECT canonicalName AS v FROM merchant_alias
         ) ORDER BY v COLLATE NOCASE LIMIT 3000`,
      )
      .all() as { v: string }[]
  ).map((r) => r.v);

  const custom = (
    db
      .prepare(
        `SELECT DISTINCT customName AS v FROM transactions
           WHERE customName IS NOT NULL AND customName != ''
           ORDER BY customName COLLATE NOCASE LIMIT 3000`,
      )
      .all() as { v: string }[]
  ).map((r) => r.v);

  // (canonicalName, customName) pairs with a usage count so we can order the
  // related custom names by frequency.
  const pairs = db
    .prepare(
      `SELECT canonicalName AS c, customName AS v, COUNT(*) AS n FROM transactions
         WHERE customName IS NOT NULL AND customName != ''
           AND canonicalName IS NOT NULL AND canonicalName != ''
         GROUP BY canonicalName, customName
         ORDER BY n DESC`,
    )
    .all() as { c: string; v: string; n: number }[];

  const customByCanonical: Record<string, string[]> = {};
  for (const { c, v } of pairs) {
    const key = c.toLowerCase();
    (customByCanonical[key] ??= []).push(v);
  }

  return { canonical, custom, customByCanonical };
}
