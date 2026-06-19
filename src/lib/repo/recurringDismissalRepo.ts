import type { Database } from "better-sqlite3";

export function makeRecurringDismissalRepo(db: Database) {
  const selectAll = db.prepare(`SELECT merchant FROM recurring_dismissals`);
  const upsert = db.prepare(
    `INSERT INTO recurring_dismissals (merchant, dismissedAt) VALUES (?, ?)
     ON CONFLICT(merchant) DO UPDATE SET dismissedAt = excluded.dismissedAt`,
  );
  const del = db.prepare(`DELETE FROM recurring_dismissals WHERE merchant = ?`);

  return {
    listMerchants(): string[] {
      return (selectAll.all() as { merchant: string }[]).map((r) => r.merchant);
    },
    dismiss(merchant: string): void {
      const trimmed = merchant.trim();
      if (!trimmed) return;
      upsert.run(trimmed, new Date().toISOString());
    },
    undismiss(merchant: string): void {
      del.run(merchant.trim());
    },
  };
}

export type RecurringDismissalRepo = ReturnType<typeof makeRecurringDismissalRepo>;
