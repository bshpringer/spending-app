import type { Database } from "better-sqlite3";
import type { Profile, User } from "../types.ts";

interface ProfileRow {
  id: string;
  displayName: string;
  color: string | null;
  ownerUserId: string | null;
  isShared: number;
  archived: number;
  createdAt: string;
}

function rowToProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    displayName: row.displayName,
    color: row.color ?? undefined,
    ownerUserId: row.ownerUserId ?? undefined,
    isShared: row.isShared === 1,
    archived: row.archived === 1,
    createdAt: row.createdAt,
  };
}

export function makeProfileRepo(db: Database) {
  const selectAll = db.prepare(
    `SELECT * FROM profiles WHERE archived = 0 ORDER BY isShared DESC, displayName`,
  );
  const selectById = db.prepare(`SELECT * FROM profiles WHERE id = ?`);
  const selectAccessForUser = db.prepare(
    `SELECT p.* FROM profiles p
     JOIN profile_access pa ON pa.profileId = p.id
     WHERE pa.userId = ? AND p.archived = 0
     ORDER BY p.isShared DESC, p.displayName`,
  );
  const insert = db.prepare(
    `INSERT INTO profiles (id, displayName, color, ownerUserId, isShared, archived, createdAt)
     VALUES (@id, @displayName, @color, @ownerUserId, @isShared, 0, @createdAt)`,
  );
  const updateRow = db.prepare(
    `UPDATE profiles SET displayName = @displayName, color = @color WHERE id = @id`,
  );
  const archiveRow = db.prepare(`UPDATE profiles SET archived = 1 WHERE id = ?`);
  const insertAccess = db.prepare(
    `INSERT OR IGNORE INTO profile_access (userId, profileId) VALUES (?, ?)`,
  );
  const deleteAccess = db.prepare(
    `DELETE FROM profile_access WHERE userId = ? AND profileId = ?`,
  );
  const accessibleIdsForUser = db.prepare(
    `SELECT pa.profileId AS id FROM profile_access pa
     JOIN profiles p ON p.id = pa.profileId
     WHERE pa.userId = ? AND p.archived = 0`,
  );
  const selectUser = db.prepare(`SELECT * FROM users WHERE id = ?`);

  return {
    list(): Profile[] {
      return (selectAll.all() as ProfileRow[]).map(rowToProfile);
    },
    listForUser(userId: string): Profile[] {
      return (selectAccessForUser.all(userId) as ProfileRow[]).map(rowToProfile);
    },
    findById(id: string): Profile | null {
      const row = selectById.get(id) as ProfileRow | undefined;
      return row ? rowToProfile(row) : null;
    },
    accessibleIds(userId: string): string[] {
      return (accessibleIdsForUser.all(userId) as { id: string }[]).map((r) => r.id);
    },
    create(input: { id: string; displayName: string; color?: string; ownerUserId?: string; isShared?: boolean }): Profile {
      insert.run({
        id: input.id,
        displayName: input.displayName,
        color: input.color ?? null,
        ownerUserId: input.ownerUserId ?? null,
        isShared: input.isShared ? 1 : 0,
        createdAt: new Date().toISOString(),
      });
      return rowToProfile(selectById.get(input.id) as ProfileRow);
    },
    update(id: string, patch: { displayName?: string; color?: string | null }): void {
      const existing = selectById.get(id) as ProfileRow | undefined;
      if (!existing) throw new Error(`Profile ${id} not found`);
      updateRow.run({
        id,
        displayName: patch.displayName ?? existing.displayName,
        color: patch.color === undefined ? existing.color : patch.color,
      });
    },
    archive(id: string): void {
      archiveRow.run(id);
    },
    grantAccess(userId: string, profileId: string): void {
      insertAccess.run(userId, profileId);
    },
    revokeAccess(userId: string, profileId: string): void {
      deleteAccess.run(userId, profileId);
    },
    findUser(userId: string): User | null {
      const row = selectUser.get(userId) as { id: string; displayName: string; createdAt: string } | undefined;
      return row ? { id: row.id, displayName: row.displayName, createdAt: row.createdAt } : null;
    },
  };
}

export type ProfileRepo = ReturnType<typeof makeProfileRepo>;
