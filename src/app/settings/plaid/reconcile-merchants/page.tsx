import Link from "next/link";
import { getDb } from "@/lib/db.ts";
import { makeTransactionRepo } from "@/lib/repo/transactionRepo.ts";
import { makeMerchantTriageRepo } from "@/lib/repo/merchantTriageRepo.ts";
import { buildTriageClusters } from "@/lib/merchantTriage.ts";
import { TriageClient } from "./TriageClient.tsx";

export const dynamic = "force-dynamic";

export default async function ReconcileMerchantsPage() {
  const db = getDb();
  const txnRepo = makeTransactionRepo(db);
  const triageRepo = makeMerchantTriageRepo(db);

  const allTxns = txnRepo.list();
  const dismissedStems = triageRepo.dismissedStems();
  const clusters = buildTriageClusters(allTxns, dismissedStems);
  const existingCategories = txnRepo.distinctCategories();

  const reconciledRows = allTxns.filter(
    (t) => t.canonicalName && t.canonicalName.trim() !== "",
  ).length;
  const activeClusters = clusters.filter((c) => !c.dismissed);
  const unreconciledRows = activeClusters.reduce((sum, c) => sum + c.txnCount, 0);

  return (
    <main style={{ padding: "2rem", maxWidth: 1100, margin: "0 auto", width: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: "0.5rem" }}>
        <Link href="/settings/plaid" style={{ fontSize: 14, color: "#1a1f3a" }}>
          ← Plaid
        </Link>
        <h1 style={{ fontSize: "1.625rem", margin: 0 }}>Reconcile merchants</h1>
        <Link
          href="/settings/plaid/merchant-aliases"
          style={{ fontSize: 14, color: "#1a1f3a", marginLeft: "auto" }}
        >
          Manage aliases →
        </Link>
      </div>
      <p style={{ opacity: 0.7, fontSize: 14, marginBottom: "1.25rem", maxWidth: 760 }}>
        Your unreconciled transactions, grouped by merchant. <strong>Confirm</strong> writes
        the canonical name onto every matching transaction and saves an alias so future
        Plaid syncs of this merchant resolve automatically. <strong>Ignore</strong> hides a
        group you don&apos;t care about (one-offs, transfers) — reversible anytime. Existing
        categories are never touched.
      </p>

      <TriageClient
        clusters={clusters}
        existingCategories={existingCategories}
        reconciledRows={reconciledRows}
        unreconciledRows={unreconciledRows}
      />
    </main>
  );
}
