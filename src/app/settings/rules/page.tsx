import { listRules } from "@/lib/actions.ts";
import { getDb } from "@/lib/db.ts";
import { makeCategoryRepo } from "@/lib/repo/categoryRepo.ts";
import { makeTagRepo } from "@/lib/repo/tagRepo.ts";
import { makeAccountRepo } from "@/lib/repo/accountRepo.ts";
import { accessibleProfiles } from "@/lib/auth.ts";
import { formatAccountLabel } from "@/lib/format.ts";
import RulesClient from "./RulesClient.tsx";
import type { RuleBuilderOptions } from "./RulesClient.tsx";

export default async function RulesPage() {
  const db = getDb();
  const rules = await listRules();

  const categories = makeCategoryRepo(db)
    .list()
    .map((c) => c.displayName)
    .sort();

  const tags = makeTagRepo(db)
    .list()
    .map((t) => ({ id: t.id, label: t.displayName }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const accounts = makeAccountRepo(db)
    .list()
    .map((a) => ({
      id: a.id,
      label: formatAccountLabel(a),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const names = (
    db
      .prepare(
        `SELECT DISTINCT name FROM transactions ORDER BY name LIMIT 2000`,
      )
      .all() as { name: string }[]
  ).map((r) => r.name);

  const profiles = accessibleProfiles()
    .map((p) => ({ id: p.id, label: p.displayName }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const options: RuleBuilderOptions = { categories, tags, accounts, profiles, names };

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "32px 24px" }}>
      <h1 style={{ fontSize: 26, fontWeight: 700, margin: "0 0 6px" }}>Rules</h1>
      <p style={{ color: "#666", fontSize: 16, margin: "0 0 24px" }}>
        Rules run at query time — they don&apos;t modify stored transactions.
        All matching rules apply; later rules can override earlier ones.
      </p>
      <RulesClient initialRules={rules} options={options} />
    </main>
  );
}
