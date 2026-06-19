import Link from "next/link";
import { getDb } from "@/lib/db.ts";
import { makeMerchantAliasRepo } from "@/lib/repo/merchantAliasRepo.ts";
import { makeTransactionRepo } from "@/lib/repo/transactionRepo.ts";
import { AliasesClient, type AliasView } from "./AliasesClient.tsx";

export const dynamic = "force-dynamic";

export default async function MerchantAliasesPage() {
  const db = getDb();
  const aliasRepo = makeMerchantAliasRepo(db);
  const txnRepo = makeTransactionRepo(db);
  const aliases = aliasRepo.list();
  const allSources = aliasRepo.listAllSources();
  const rejects = aliasRepo.listRejects();
  const existingCategories = txnRepo.distinctCategories();

  const countByCanonical = db
    .prepare(
      `SELECT canonicalName, COUNT(*) AS n FROM transactions WHERE canonicalName IS NOT NULL GROUP BY canonicalName`,
    )
    .all() as { canonicalName: string; n: number }[];
  const countMap = new Map(countByCanonical.map((r) => [r.canonicalName, r.n]));

  const views: AliasView[] = aliases.map((a) => ({
    canonicalName: a.canonicalName,
    defaultCategory: a.defaultCategory,
    confidence: a.confidence,
    sources: allSources.filter((s) => s.canonicalName === a.canonicalName),
    txnCount: countMap.get(a.canonicalName) ?? 0,
  }));

  return (
    <main style={{ padding: "2rem", maxWidth: 1000, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: "0.5rem" }}>
        <Link href="/settings/plaid" style={{ fontSize: 14, color: "#1a1f3a" }}>
          ← Plaid
        </Link>
        <h1 style={{ fontSize: "1.625rem", margin: 0 }}>Merchant aliases</h1>
        <Link
          href="/settings/plaid/reconcile-merchants"
          style={{ fontSize: 14, color: "#1a1f3a", marginLeft: "auto" }}
        >
          Reconcile merchants →
        </Link>
      </div>
      <p style={{ opacity: 0.7, fontSize: 14, marginBottom: "1.25rem" }}>
        Each alias maps one or more raw merchant patterns (from Rocket CSVs or
        Plaid syncs) to a single canonical display name. The default category
        pre-fills incoming Plaid syncs.
      </p>
      <AliasesClient
        aliases={views}
        rejects={rejects}
        existingCategories={existingCategories}
      />
    </main>
  );
}
