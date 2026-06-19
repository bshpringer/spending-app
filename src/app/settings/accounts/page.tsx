import Link from "next/link";
import { getDb } from "@/lib/db";
import { makeAccountRepo } from "@/lib/repo/accountRepo";
import { makeTagRepo } from "@/lib/repo/tagRepo";
import { AccountRow } from "./AccountRow.tsx";
import { accessibleProfiles } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const db = getDb();
  const accounts = makeAccountRepo(db).list();
  const tags = makeTagRepo(db).list();
  const txCountByAccount = countTransactionsByAccount(db);
  const profiles = accessibleProfiles().map((p) => ({ id: p.id, displayName: p.displayName, color: p.color }));

  return (
    <main style={{ padding: "2rem", maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ fontSize: "1.625rem", margin: "0.5rem 0 1rem" }}>
        Accounts ({accounts.length})
      </h1>
      <p style={{ opacity: 0.7, fontSize: "1.025rem", marginBottom: "1.5rem" }}>
        Tag an account to inherit that tag onto every transaction on it. The
        canonical shared/personal silo lives here — tag the joint card{" "}
        <code>shared</code> once and every transaction on it filters as{" "}
        <code>shared</code>.
      </p>

      {accounts.length === 0 ? (
        <p style={{ opacity: 0.7 }}>
          No accounts yet.{" "}
          <Link href="/settings/import" style={{ textDecoration: "underline" }}>
            Import a CSV
          </Link>{" "}
          to populate them.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
          {groupByType(accounts).map(({ type, items }) => (
            <section key={type}>
              <h2 style={{ fontSize: "1.025rem", fontWeight: 600, opacity: 0.6, margin: "0 0 0.75rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {type}
              </h2>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {items.map((a) => (
                  <AccountRow
                    key={a.id}
                    account={a}
                    allTags={tags.map((t) => ({ id: t.id, displayName: t.displayName }))}
                    transactionCount={txCountByAccount.get(a.id) ?? 0}
                    profiles={profiles}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}

function groupByType(accounts: Awaited<ReturnType<ReturnType<typeof makeAccountRepo>["list"]>>) {
  const order = ["Credit Card", "Cash", "Investment"];
  const map = new Map<string, typeof accounts>();
  for (const a of accounts) {
    const bucket = map.get(a.accountType) ?? [];
    bucket.push(a);
    map.set(a.accountType, bucket);
  }
  const sorted = [...map.entries()].sort(([a], [b]) => {
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
  return sorted.map(([type, items]) => ({ type, items }));
}

function countTransactionsByAccount(db: ReturnType<typeof getDb>): Map<string, number> {
  const rows = db
    .prepare(`SELECT accountId, COUNT(*) AS c FROM transactions GROUP BY accountId`)
    .all() as { accountId: string; c: number }[];
  return new Map(rows.map((r) => [r.accountId, r.c]));
}
