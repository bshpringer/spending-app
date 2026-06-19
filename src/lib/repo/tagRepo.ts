import type { Database } from "better-sqlite3";
import type { Tag } from "../types.ts";

export function slugify(displayName: string): string {
  return displayName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function makeTagRepo(db: Database) {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO tags (id, displayName, createdAt)
     VALUES (@id, @displayName, @createdAt)`,
  );
  const selectById = db.prepare(`SELECT * FROM tags WHERE id = ?`);
  const selectAll = db.prepare(`SELECT * FROM tags ORDER BY displayName`);
  const updateColor = db.prepare(`UPDATE tags SET color = ? WHERE id = ?`);
  const updateDescription = db.prepare(`UPDATE tags SET description = ? WHERE id = ?`);

  return {
    ensureExists(displayName: string): Tag {
      const id = slugify(displayName);
      if (!id) throw new Error(`tag displayName slugified to empty: ${JSON.stringify(displayName)}`);
      insert.run({ id, displayName, createdAt: new Date().toISOString() });
      return selectById.get(id) as Tag;
    },
    list(): Tag[] {
      return selectAll.all() as Tag[];
    },
    setColor(id: string, color: string | null) {
      updateColor.run(color, id);
    },
    setDescription(id: string, description: string | null) {
      updateDescription.run(description, id);
    },
  };
}

export type TagRepo = ReturnType<typeof makeTagRepo>;
