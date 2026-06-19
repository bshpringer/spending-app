import type { Database } from "better-sqlite3";

// Smart default classification for newly-seen categories.
//
// Categories are classified as expense / income / ignored, which decides where
// they show up (Trends income vs spend, pacing, etc). Most categories are
// spending, so "expense" is the default — but a few names are obviously income
// (interest, payroll…) or internal money-movement that shouldn't count either
// way (transfers, credit-card payments). Guessing those up front saves the user
// from hunting them down on the Categories page.
//
// This only ever applies to NEW category rows; it never reclassifies a category
// the user already has (the inserts are INSERT OR IGNORE).

const INCOME_PATTERNS: RegExp[] = [
  /\binterest\b/,
  /dividend/,
  /payroll/,
  /\bincome\b/,
  /\bsalary\b/,
  /\bwages?\b/,
  /reimburse/,
];

const IGNORED_PATTERNS: RegExp[] = [
  /transfer/,
  /credit\s*card\s*payment/,
  /\bcc\s*payment\b/,
];

export function classifyCategoryName(name: string): "income" | "expense" | "ignored" {
  const n = name.toLowerCase();
  if (INCOME_PATTERNS.some((re) => re.test(n))) return "income";
  if (IGNORED_PATTERNS.some((re) => re.test(n))) return "ignored";
  return "expense";
}

/**
 * Create category rows for any category strings present on transactions that
 * don't have a row yet (and aren't tombstoned), classifying each by name.
 * Replaces the old hardcoded-'expense' SQL backfill. Safe to run repeatedly.
 */
export function backfillCategoryRows(db: Database): void {
  const rows = db
    .prepare(
      `SELECT DISTINCT t.category AS category
       FROM transactions t
       LEFT JOIN deleted_categories d ON d.displayName = t.category
       LEFT JOIN categories c ON c.displayName = t.category
       WHERE t.category != '' AND d.displayName IS NULL AND c.displayName IS NULL`,
    )
    .all() as { category: string }[];
  if (rows.length === 0) return;

  const insert = db.prepare(
    `INSERT OR IGNORE INTO categories (displayName, classification, createdAt)
     VALUES (?, ?, datetime('now'))`,
  );
  const insertAll = db.transaction((items: { category: string }[]) => {
    for (const r of items) insert.run(r.category, classifyCategoryName(r.category));
  });
  insertAll(rows);
}
