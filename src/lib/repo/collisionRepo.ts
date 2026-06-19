import type { Database } from "better-sqlite3";

export type CollisionStatus = "legit" | "possible_duplicate";

export interface CollisionDecision {
  baseDedupeKey: string;
  status: CollisionStatus;
  note: string | null;
  decidedAt: string;
}

export function makeCollisionRepo(db: Database) {
  const upsert = db.prepare(
    `INSERT INTO collision_decisions (baseDedupeKey, status, note, decidedAt)
     VALUES (@baseDedupeKey, @status, @note, @decidedAt)
     ON CONFLICT(baseDedupeKey) DO UPDATE SET
       status = excluded.status,
       note = excluded.note,
       decidedAt = excluded.decidedAt`,
  );
  const selectAll = db.prepare(`SELECT * FROM collision_decisions`);
  const del = db.prepare(`DELETE FROM collision_decisions WHERE baseDedupeKey = ?`);

  return {
    set(baseDedupeKey: string, status: CollisionStatus, note: string | null = null) {
      upsert.run({
        baseDedupeKey,
        status,
        note,
        decidedAt: new Date().toISOString(),
      });
    },
    list(): CollisionDecision[] {
      return selectAll.all() as CollisionDecision[];
    },
    clear(baseDedupeKey: string) {
      del.run(baseDedupeKey);
    },
  };
}

export type CollisionRepo = ReturnType<typeof makeCollisionRepo>;
