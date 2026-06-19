import type { Database } from "better-sqlite3";

export interface TriageDismissal {
  stem: string;
  label: string;
  dismissedAt: string;
}

/**
 * Per-cluster dismissals for the merchant triage page. Mirrors
 * recurringDismissalRepo: global (not profile-scoped), keyed by the
 * normalized merchant stem so the dismissal survives raw-name variants.
 */
export function makeMerchantTriageRepo(db: Database) {
  const selectAll = db.prepare(
    `SELECT stem, label, dismissedAt FROM merchant_triage_dismissals ORDER BY dismissedAt DESC`,
  );
  const upsert = db.prepare(
    `INSERT INTO merchant_triage_dismissals (stem, label, dismissedAt) VALUES (?, ?, ?)
     ON CONFLICT(stem) DO UPDATE SET label = excluded.label, dismissedAt = excluded.dismissedAt`,
  );
  const del = db.prepare(`DELETE FROM merchant_triage_dismissals WHERE stem = ?`);

  return {
    list(): TriageDismissal[] {
      return selectAll.all() as TriageDismissal[];
    },
    dismissedStems(): Set<string> {
      return new Set((selectAll.all() as TriageDismissal[]).map((r) => r.stem));
    },
    dismiss(stem: string, label: string): void {
      const trimmed = stem.trim();
      if (!trimmed) return;
      upsert.run(trimmed, label.trim(), new Date().toISOString());
    },
    undismiss(stem: string): void {
      del.run(stem.trim());
    },
  };
}

export type MerchantTriageRepo = ReturnType<typeof makeMerchantTriageRepo>;
