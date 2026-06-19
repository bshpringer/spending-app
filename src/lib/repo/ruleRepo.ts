import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import type { Rule, RuleCondition, RuleAction } from "../types.ts";

interface RuleRow {
  id: string;
  name: string;
  enabled: number;
  priority: number;
  conditions: string;
  actions: string;
  createdAt: string;
  updatedAt: string;
}

function rowToRule(row: RuleRow): Rule {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled === 1,
    priority: row.priority,
    conditions: JSON.parse(row.conditions) as RuleCondition[],
    actions: JSON.parse(row.actions) as RuleAction[],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function makeRuleRepo(db: Database) {
  const selectAll = db.prepare(
    `SELECT * FROM rules ORDER BY priority ASC, createdAt ASC`,
  );

  function list(): Rule[] {
    return (selectAll.all() as RuleRow[]).map(rowToRule);
  }

  function create(
    name: string,
    conditions: RuleCondition[],
    actions: RuleAction[],
  ): Rule {
    const now = new Date().toISOString();
    // New rules go to the top: bump every existing rule's priority by 1,
    // then insert at priority 0. Sort order is ASC, so lower = first/higher precedence.
    db.prepare(`UPDATE rules SET priority = priority + 1`).run();
    const id = randomUUID();
    db.prepare(
      `INSERT INTO rules (id, name, enabled, priority, conditions, actions, createdAt, updatedAt)
       VALUES (?, ?, 1, 0, ?, ?, ?, ?)`,
    ).run(id, name, JSON.stringify(conditions), JSON.stringify(actions), now, now);
    return rowToRule(
      db.prepare(`SELECT * FROM rules WHERE id = ?`).get(id) as RuleRow,
    );
  }

  function update(
    id: string,
    patch: Partial<Pick<Rule, "name" | "enabled" | "conditions" | "actions">>,
  ): void {
    const now = new Date().toISOString();
    if (patch.name !== undefined) {
      db.prepare(`UPDATE rules SET name = ?, updatedAt = ? WHERE id = ?`).run(patch.name, now, id);
    }
    if (patch.enabled !== undefined) {
      db.prepare(`UPDATE rules SET enabled = ?, updatedAt = ? WHERE id = ?`).run(
        patch.enabled ? 1 : 0,
        now,
        id,
      );
    }
    if (patch.conditions !== undefined) {
      db.prepare(`UPDATE rules SET conditions = ?, updatedAt = ? WHERE id = ?`).run(
        JSON.stringify(patch.conditions),
        now,
        id,
      );
    }
    if (patch.actions !== undefined) {
      db.prepare(`UPDATE rules SET actions = ?, updatedAt = ? WHERE id = ?`).run(
        JSON.stringify(patch.actions),
        now,
        id,
      );
    }
  }

  function remove(id: string): void {
    db.prepare(`DELETE FROM rules WHERE id = ?`).run(id);
  }

  function reorder(ids: string[]): void {
    const now = new Date().toISOString();
    const stmt = db.prepare(`UPDATE rules SET priority = ?, updatedAt = ? WHERE id = ?`);
    const tx = db.transaction((orderedIds: string[]) => {
      orderedIds.forEach((id, idx) => stmt.run(idx, now, id));
    });
    tx(ids);
  }

  return { list, create, update, remove, reorder };
}

export type RuleRepo = ReturnType<typeof makeRuleRepo>;
