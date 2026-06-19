import { getDb } from "../../lib/db.ts";
import { makeTransactionRepo } from "../../lib/repo/transactionRepo.ts";
import { makeAccountRepo } from "../../lib/repo/accountRepo.ts";
import { makeTagRepo } from "../../lib/repo/tagRepo.ts";
import { makeDuplicateReviewRepo } from "../../lib/repo/duplicateReviewRepo.ts";
import { detectDuplicates } from "../../lib/duplicates.ts";
import { resolveProfileFilter } from "../../lib/auth.ts";
import { formatAccountLabel } from "../../lib/format.ts";
import type { Transaction } from "../../lib/types.ts";
import DuplicatesClient, { type DuplicateReviewedRow, type DuplicateSuggestionRow } from "./DuplicatesClient.tsx";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ profile?: string; tab?: string }>;

export default async function DuplicatesPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const profileIds = resolveProfileFilter(sp.profile);

  const db = getDb();
  const txRepo = makeTransactionRepo(db);
  const reviewRepo = makeDuplicateReviewRepo(db);

  // No date bound — surface every potential dupe in history. Personal-scale
  // dataset, detectDuplicates is per-account so the cost is negligible.
  const transactions = txRepo.query({
    profileIds: profileIds ?? undefined,
  });

  const accounts = makeAccountRepo(db).list();
  const accountLabelMap = new Map<string, string>(
    accounts.map((a) => [a.id, formatAccountLabel(a)]),
  );
  const accountLabel = (tx: Transaction) =>
    tx.accountId ? accountLabelMap.get(tx.accountId) ?? "" : "(manual)";

  const keptPairs = reviewRepo.keptPairKeys();
  const suggestions = detectDuplicates(transactions, keptPairs);

  // Hydrate reviewed-pair rows; respect profile filter same as Refunds.
  const reviewedRows: DuplicateReviewedRow[] = [];
  for (const row of reviewRepo.list()) {
    const a = txRepo.getById(row.txAId);
    const b = txRepo.getById(row.txBId);
    if (!a || !b) continue;
    if (profileIds && !profileIds.includes(a.profileId) && !profileIds.includes(b.profileId)) continue;
    reviewedRows.push({
      a,
      b,
      aAccountLabel: accountLabel(a),
      bAccountLabel: accountLabel(b),
      createdAt: row.createdAt,
    });
  }

  const suggestionRows: DuplicateSuggestionRow[] = suggestions.map((s) => ({
    a: s.a,
    b: s.b,
    aAccountLabel: accountLabel(s.a),
    bAccountLabel: accountLabel(s.b),
    confidence: s.confidence,
    reason: s.reason,
    daysApart: s.daysApart,
  }));

  const initialTab = sp.tab === "reviewed" ? "reviewed" : "suggested";

  const availableTags = makeTagRepo(db).list().map((t) => ({ id: t.id, displayName: t.displayName }));
  const availableCategories = txRepo.distinctCategories();
  const accountLabels: Record<string, string> = Object.fromEntries(
    accounts.map((a) => [a.id, formatAccountLabel(a)]),
  );

  return (
    <DuplicatesClient
      suggestions={suggestionRows}
      reviewed={reviewedRows}
      profileParam={sp.profile}
      initialTab={initialTab}
      availableTags={availableTags}
      availableCategories={availableCategories}
      accountLabels={accountLabels}
    />
  );
}
