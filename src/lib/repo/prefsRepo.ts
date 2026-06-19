import type { Database } from "better-sqlite3";

/**
 * App-wide preferences, persisted in the generic `meta` key/value table (the
 * same store used for migration markers). No dedicated table is needed — these
 * are a handful of singleton scalars, not relational data.
 *
 * Keys are namespaced with a `pref_` prefix so they never collide with the
 * migration-marker rows that also live in `meta`.
 */

const KEY_DATA_START_DATE = "pref_data_start_date";
const KEY_HIDE_EXCLUDED_DEFAULT = "pref_hide_excluded_default";

export interface AppPreferences {
  /**
   * ISO `YYYY-MM-DD`. A global lower bound on the **aggregation date** for every
   * transaction read (see `transactionRepo.buildWhereClauses`): the app behaves
   * as if no transaction exists before this date. Writes/imports are unaffected
   * (they use `bulkUpsert`/`updateTransaction`, not `query`). Empty string =
   * no floor (show all history). Net Worth reads through `plaidBalanceRepo` and
   * is intentionally NOT floored by this.
   */
  dataStartDate: string;
  /**
   * When true, transaction tables hide `excluded` rows by default (the user can
   * still flip the per-table control to show them). When false, excluded rows
   * show by default (historical behavior).
   */
  hideExcludedByDefault: boolean;
}

export const DEFAULT_PREFERENCES: AppPreferences = {
  dataStartDate: "",
  hideExcludedByDefault: false,
};

export function makePrefsRepo(db: Database) {
  const getStmt = db.prepare(`SELECT value FROM meta WHERE key = ?`);
  const upsertStmt = db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  );

  const readRaw = (key: string): string | null => {
    const row = getStmt.get(key) as { value: string } | undefined;
    return row ? row.value : null;
  };

  return {
    getAll(): AppPreferences {
      return {
        dataStartDate: readRaw(KEY_DATA_START_DATE) ?? DEFAULT_PREFERENCES.dataStartDate,
        hideExcludedByDefault: readRaw(KEY_HIDE_EXCLUDED_DEFAULT) === "1",
      };
    },

    /** Convenience scalar read used by the transaction-repo read floor. */
    getDataStartDate(): string {
      return readRaw(KEY_DATA_START_DATE) ?? DEFAULT_PREFERENCES.dataStartDate;
    },

    /** Partial update — only the provided keys are written. */
    update(patch: Partial<AppPreferences>): void {
      if (patch.dataStartDate !== undefined) {
        upsertStmt.run(KEY_DATA_START_DATE, patch.dataStartDate);
      }
      if (patch.hideExcludedByDefault !== undefined) {
        upsertStmt.run(KEY_HIDE_EXCLUDED_DEFAULT, patch.hideExcludedByDefault ? "1" : "0");
      }
    },
  };
}
