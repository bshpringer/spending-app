import { notFound } from "next/navigation";
import Link from "next/link";
import { getDb } from "@/lib/db.ts";
import { makePlaidItemRepo } from "@/lib/repo/plaidItemRepo.ts";
import { makePlaidStagingRepo } from "@/lib/repo/plaidStagingRepo.ts";
import { makePlaidStagingRemovalsRepo } from "@/lib/repo/plaidStagingRemovalsRepo.ts";
import { makeAccountRepo } from "@/lib/repo/accountRepo.ts";
import { makeTransactionRepo } from "@/lib/repo/transactionRepo.ts";
import { makeRuleRepo } from "@/lib/repo/ruleRepo.ts";
import { makeMerchantAliasRepo } from "@/lib/repo/merchantAliasRepo.ts";
import { plaidCategoryFromRawFull } from "@/lib/plaid/mapPlaidTransaction.ts";
import { buildRawDetail } from "./rawDetail.ts";
import { accessibleProfiles } from "@/lib/auth.ts";
import { formatAccountLabel } from "@/lib/format.ts";
import { ReviewClient, type StagedRowView, type MatchedTxnView, type RemovalRowView } from "./ReviewClient.tsx";
import { previewRulesForStagedRow } from "./stagingRulePreview.ts";
import { getNameSuggestions } from "./nameSuggestions.ts";

export const dynamic = "force-dynamic";

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ itemId: string }>;
}) {
  const { itemId } = await params;
  const db = getDb();
  const itemRepo = makePlaidItemRepo(db);
  const stagingRepo = makePlaidStagingRepo(db);
  const removalsRepo = makePlaidStagingRemovalsRepo(db);
  const accountRepo = makeAccountRepo(db);
  const transactionRepo = makeTransactionRepo(db);

  const item = itemRepo.getByItemId(itemId);
  if (!item) notFound();

  const staged = stagingRepo.listByItem(itemId);
  const removals = removalsRepo.listByItem(itemId);
  const accounts = accountRepo.list();
  const accountLabelById = new Map(accounts.map((a) => [a.id, formatAccountLabel(a)]));
  const accountInstitutionById = new Map(accounts.map((a) => [a.id, a.institutionName]));

  // Look up matched transactions (for flagged rows) so the UI can show what
  // "merge" would dedupe against.
  const matchedById = new Map<string, MatchedTxnView>();
  const hydrateMatched = (id: string | null) => {
    if (!id || matchedById.has(id)) return;
    const t = transactionRepo.getById(id);
    if (t) {
      matchedById.set(id, {
        id: t.id,
        date: t.date,
        name: t.customName ?? t.name,
        amount: t.amount,
        category: t.category,
      });
    }
  };
  for (const row of staged) {
    hydrateMatched(row.matchedTransactionId);
    hydrateMatched(row.replacesTransactionId);
  }

  const removalRows: RemovalRowView[] = removals.map((r) => ({
    plaidTransactionId: r.plaidTransactionId,
    matchedTransactionId: r.matchedTransactionId,
    matchedDate: r.matchedDate,
    matchedName: r.matchedName,
    matchedAmount: r.matchedAmount,
    proposedAction: r.proposedAction,
    replacementHint: r.replacementHint,
  }));

  const rules = makeRuleRepo(db).list();
  const aliasRepo = makeMerchantAliasRepo(db);
  // A row's Category is alias-driven (→ blue) only when an alias matches its
  // Plaid name, the staged category still equals that alias's defaultCategory
  // (mirrors the sync-time pre-fill), AND that category actually differs from
  // what Plaid originally assigned — i.e. the alias overwrote Plaid, not just
  // restated it. Goes null once the user overrides it.
  const categoryFromAlias = (name: string, category: string, plaidRawFull: string | null): boolean => {
    const hit = aliasRepo.lookupBySourcePattern(name, "plaid");
    if (!hit || hit.confidence === "low" || !hit.defaultCategory || hit.defaultCategory !== category) {
      return false;
    }
    const plaidCat = plaidCategoryFromRawFull(plaidRawFull);
    return plaidCat != null && plaidCat !== category;
  };
  const rows: StagedRowView[] = staged.map((r) => ({
    stagingId: r.stagingId,
    plaidTransactionId: r.plaidTransactionId,
    accountId: r.accountId,
    accountLabel: r.accountId ? (accountLabelById.get(r.accountId) ?? null) : null,
    accountInstitution: r.accountId ? (accountInstitutionById.get(r.accountId) ?? null) : null,
    profileId: r.profileId,
    date: r.date,
    originalDate: r.originalDate,
    name: r.name,
    customName: r.customName,
    canonicalName: r.canonicalName,
    amount: r.amount,
    description: r.description,
    category: r.category,
    note: r.note,
    tags: r.tags,
    proposedAction: r.proposedAction,
    matchedTransactionId: r.matchedTransactionId,
    flagReason: r.flagReason,
    replacesTransactionId: r.replacesTransactionId,
    canonicalSource: r.canonicalName ? (r.prefilledFromMediumAlias ? "alias-medium" : "alias") : null,
    categorySource: categoryFromAlias(r.name, r.category, r.plaidRawFull) ? "alias" : null,
    plaidCategory: plaidCategoryFromRawFull(r.plaidRawFull),
    rawDetail: buildRawDetail(r.plaidRaw, r.plaidRawFull),
    rulePreview: previewRulesForStagedRow(rules, {
      accountId: r.accountId,
      profileId: r.profileId,
      date: r.date,
      originalDate: r.originalDate,
      name: r.name,
      customName: r.customName,
      canonicalName: r.canonicalName,
      amount: r.amount,
      description: r.description,
      category: r.category,
      note: r.note,
      tags: r.tags,
    }),
  }));

  const profiles = accessibleProfiles();

  const categories = transactionRepo.distinctCategories();
  const suggestions = getNameSuggestions(db);

  return (
    <main style={{ padding: "2rem", maxWidth: 1400, margin: "0 auto", width: "100%" }}>
      <div style={{ marginBottom: "0.75rem" }}>
        <Link
          href="/settings/plaid"
          style={{ fontSize: 14, color: "#1a1f3a", textDecoration: "none" }}
        >
          ← Back to banks
        </Link>
      </div>
      <h1 style={{ fontSize: "1.625rem", margin: "0 0 0.25rem" }}>
        Review staged transactions
      </h1>
      <div style={{ fontSize: 14, opacity: 0.7, marginBottom: "1.25rem" }}>
        {item.institutionName ?? "(unknown institution)"} · {rows.length} pulled
        {removalRows.length > 0 ? ` · ${removalRows.length} removed by Plaid` : ""}
      </div>
      {rows.length === 0 && removalRows.length === 0 ? (
        <p style={{ opacity: 0.7 }}>
          Nothing staged. (Discard would normally clear pending state — if there&apos;s
          a leftover pendingCursor, discard from the banks page.)
        </p>
      ) : (
        <ReviewClient
          itemId={itemId}
          rows={rows}
          removalRows={removalRows}
          matchedById={Object.fromEntries(matchedById)}
          categories={categories}
          profiles={profiles}
          canonicalSuggestions={suggestions.canonical}
          customSuggestions={suggestions.custom}
          customByCanonical={suggestions.customByCanonical}
        />
      )}
    </main>
  );
}
