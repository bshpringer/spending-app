import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import type { Account, ParsedAccount } from "../types.ts";
import {
  defaultGroupFromAccountType,
  isAccountGroup,
  type AccountGroup,
} from "../accountGroups.ts";
import { DEFAULT_PROFILE_ID } from "../constants.ts";

interface AccountRow {
  id: string;
  accountName: string;
  customName: string | null;
  accountNumberLast4: string;
  institutionName: string;
  accountType: string;
  accountGroup: string | null;
  profileId: string | null;
  archived: number;
  createdAt: string;
  updatedAt: string;
  naturalKey: string;
}

function rowToAccount(row: AccountRow, tags: string[]): Account {
  const group: AccountGroup | null = isAccountGroup(row.accountGroup)
    ? row.accountGroup
    : null;
  return {
    id: row.id,
    accountName: row.accountName,
    customName: row.customName ?? undefined,
    accountNumberLast4: row.accountNumberLast4,
    institutionName: row.institutionName,
    accountType: row.accountType,
    accountGroup: group,
    profileId: row.profileId ?? DEFAULT_PROFILE_ID,
    tags,
    archived: row.archived === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function makeAccountRepo(db: Database) {
  const selectByNaturalKey = db.prepare(`SELECT * FROM accounts WHERE naturalKey = ?`);
  const selectById = db.prepare(`SELECT * FROM accounts WHERE id = ?`);
  const selectAll = db.prepare(`SELECT * FROM accounts ORDER BY institutionName, accountName`);
  const insert = db.prepare(
    `INSERT INTO accounts (id, accountName, customName, accountNumberLast4, institutionName, accountType, accountGroup, profileId, archived, createdAt, updatedAt, naturalKey)
     VALUES (@id, @accountName, @customName, @accountNumberLast4, @institutionName, @accountType, @accountGroup, @profileId, 0, @createdAt, @updatedAt, @naturalKey)`,
  );
  const updateGroup = db.prepare(
    `UPDATE accounts SET accountGroup = ?, updatedAt = ? WHERE id = ?`,
  );
  const updateProfile = db.prepare(
    `UPDATE accounts SET profileId = ?, updatedAt = ? WHERE id = ?`,
  );
  const selectTagsForAccount = db.prepare(
    `SELECT t.id FROM account_tags at JOIN tags t ON t.id = at.tagId WHERE at.accountId = ? ORDER BY t.displayName`,
  );
  const insertAccountTag = db.prepare(
    `INSERT OR IGNORE INTO account_tags (accountId, tagId) VALUES (?, ?)`,
  );
  const deleteAccountTag = db.prepare(
    `DELETE FROM account_tags WHERE accountId = ? AND tagId = ?`,
  );
  const updateCustomName = db.prepare(
    `UPDATE accounts SET customName = ?, updatedAt = ? WHERE id = ?`,
  );
  const updateArchived = db.prepare(
    `UPDATE accounts SET archived = ?, updatedAt = ? WHERE id = ?`,
  );

  function tagsFor(accountId: string): string[] {
    return (selectTagsForAccount.all(accountId) as { id: string }[]).map((r) => r.id);
  }

  return {
    getOrCreate(parsed: ParsedAccount): Account {
      const existing = selectByNaturalKey.get(parsed.naturalKey) as AccountRow | undefined;
      if (existing) return rowToAccount(existing, tagsFor(existing.id));

      const now = new Date().toISOString();
      const id = randomUUID();
      const group: AccountGroup =
        parsed.accountGroup ?? defaultGroupFromAccountType(parsed.accountType);
      insert.run({
        id,
        accountName: parsed.accountName,
        customName: null,
        accountNumberLast4: parsed.accountNumberLast4,
        institutionName: parsed.institutionName,
        accountType: parsed.accountType,
        accountGroup: group,
        profileId: DEFAULT_PROFILE_ID,
        createdAt: now,
        updatedAt: now,
        naturalKey: parsed.naturalKey,
      });
      const row = selectById.get(id) as AccountRow;
      return rowToAccount(row, []);
    },
    findByNaturalKey(naturalKey: string): Account | null {
      const row = selectByNaturalKey.get(naturalKey) as AccountRow | undefined;
      if (!row) return null;
      return rowToAccount(row, tagsFor(row.id));
    },
    findById(id: string): Account | null {
      const row = selectById.get(id) as AccountRow | undefined;
      if (!row) return null;
      return rowToAccount(row, tagsFor(row.id));
    },
    list(): Account[] {
      const rows = selectAll.all() as AccountRow[];
      return rows.map((r) => rowToAccount(r, tagsFor(r.id)));
    },
    setCustomName(id: string, customName: string | null) {
      updateCustomName.run(customName, new Date().toISOString(), id);
    },
    setArchived(id: string, archived: boolean) {
      updateArchived.run(archived ? 1 : 0, new Date().toISOString(), id);
    },
    setProfile(id: string, profileId: string) {
      updateProfile.run(profileId, new Date().toISOString(), id);
    },
    setGroup(id: string, group: AccountGroup) {
      updateGroup.run(group, new Date().toISOString(), id);
    },
    addTag(accountId: string, tagId: string) {
      insertAccountTag.run(accountId, tagId);
    },
    removeTag(accountId: string, tagId: string) {
      deleteAccountTag.run(accountId, tagId);
    },
    tagMap(): Map<string, string[]> {
      const rows = db
        .prepare(`SELECT accountId, tagId FROM account_tags`)
        .all() as { accountId: string; tagId: string }[];
      const map = new Map<string, string[]>();
      for (const r of rows) {
        const list = map.get(r.accountId) ?? [];
        list.push(r.tagId);
        map.set(r.accountId, list);
      }
      return map;
    },
  };
}

export type AccountRepo = ReturnType<typeof makeAccountRepo>;
