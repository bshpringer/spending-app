import type { Database } from "better-sqlite3";
import type { Category } from "../types.ts";
import { getBestGuessIcon } from "../categoryIcons.ts";

export function makeCategoryRepo(db: Database) {
  const selectAll = db.prepare(
    `SELECT * FROM categories ORDER BY classification, displayName`,
  );
  const upsert = db.prepare(
    `INSERT OR IGNORE INTO categories (displayName, classification, icon, createdAt)
     VALUES (@displayName, @classification, @icon, @createdAt)`,
  );
  const updateClassification = db.prepare(
    `UPDATE categories SET classification = ? WHERE displayName = ?`,
  );
  const updateColor = db.prepare(
    `UPDATE categories SET color = ? WHERE displayName = ?`,
  );
  const updateIcon = db.prepare(
    `UPDATE categories SET icon = ? WHERE displayName = ?`,
  );
  const deleteStmt = db.prepare(`DELETE FROM categories WHERE displayName = ?`);

  const selectOne = db.prepare(`SELECT * FROM categories WHERE displayName = ?`);

  return {
    list(): Category[] {
      return selectAll.all() as Category[];
    },

    get(displayName: string): Category | null {
      return (selectOne.get(displayName) as Category | undefined) ?? null;
    },

    ensureExists(displayName: string): void {
      upsert.run({
        displayName,
        classification: "expense",
        icon: getBestGuessIcon(displayName),
        createdAt: new Date().toISOString(),
      });
    },

    create(input: { displayName: string; classification: string; icon: string | null; color: string | null }): void {
      // If this name was previously tombstoned, an explicit re-creation should
      // bring it back — clear the tombstone first.
      db.prepare(`DELETE FROM deleted_categories WHERE displayName = ?`).run(input.displayName);
      upsert.run({
        displayName: input.displayName,
        classification: input.classification,
        icon: input.icon ?? getBestGuessIcon(input.displayName),
        createdAt: new Date().toISOString(),
      });
      if (input.color) {
        updateColor.run(input.color, input.displayName);
      }
    },

    setClassification(displayName: string, classification: string): void {
      updateClassification.run(classification, displayName);
    },

    setColor(displayName: string, color: string | null): void {
      updateColor.run(color, displayName);
    },

    setIcon(displayName: string, icon: string | null): void {
      updateIcon.run(icon, displayName);
    },

    delete(displayName: string): void {
      deleteStmt.run(displayName);
    },
  };
}

export type CategoryRepo = ReturnType<typeof makeCategoryRepo>;
