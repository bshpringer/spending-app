import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db.ts";
import { makePlaidItemRepo } from "@/lib/repo/plaidItemRepo.ts";
import { makePlaidStagingRepo } from "@/lib/repo/plaidStagingRepo.ts";
import { makePlaidStagingRemovalsRepo } from "@/lib/repo/plaidStagingRemovalsRepo.ts";
import { makeAccountRepo } from "@/lib/repo/accountRepo.ts";
import { makeTransactionRepo } from "@/lib/repo/transactionRepo.ts";
import { makeRuleRepo } from "@/lib/repo/ruleRepo.ts";
import { makeMerchantAliasRepo } from "@/lib/repo/merchantAliasRepo.ts";
import { plaidCategoryFromRawFull } from "@/lib/plaid/mapPlaidTransaction.ts";
import { buildRawDetail } from "../review/[itemId]/rawDetail.ts";
import { accessibleProfiles } from "@/lib/auth.ts";
import { formatAccountLabel } from "@/lib/format.ts";
import type { MatchedTxnView, RemovalRowView, StagedRowView } from "../review/[itemId]/ReviewClient.tsx";
import { previewRulesForStagedRow } from "../review/[itemId]/stagingRulePreview.ts";
import { getNameSuggestions } from "../review/[itemId]/nameSuggestions.ts";
import { ReviewAllClient, type BankTabData } from "./ReviewAllClient.tsx";

export const dynamic = "force-dynamic";

export default async function ReviewAllPage({
  searchParams,
}: {
  searchParams: Promise<{ items?: string; from?: string }>;
}) {
  const { items: itemsParam, from } = await searchParams;
  const fromDashboard = from === "dashboard";
  const backHref = fromDashboard ? "/dashboard" : "/settings/plaid";
  const backLabel = fromDashboard ? "← Back to dashboard" : "← Back to banks";
  if (!itemsParam) redirect("/settings/plaid");

  const itemIds = itemsParam.split(",").filter(Boolean);
  if (itemIds.length === 0) redirect("/settings/plaid");

  const db = getDb();
  const itemRepo = makePlaidItemRepo(db);
  const stagingRepo = makePlaidStagingRepo(db);
  const removalsRepo = makePlaidStagingRemovalsRepo(db);
  const accountRepo = makeAccountRepo(db);
  const transactionRepo = makeTransactionRepo(db);

  const rules = makeRuleRepo(db).list();
  const aliasRepo = makeMerchantAliasRepo(db);
  const categoryFromAlias = (name: string, category: string, plaidRawFull: string | null): boolean => {
    const hit = aliasRepo.lookupBySourcePattern(name, "plaid");
    if (!hit || hit.confidence === "low" || !hit.defaultCategory || hit.defaultCategory !== category) {
      return false;
    }
    const plaidCat = plaidCategoryFromRawFull(plaidRawFull);
    return plaidCat != null && plaidCat !== category;
  };
  const accounts = accountRepo.list();
  const accountLabelById = new Map(accounts.map((a) => [a.id, formatAccountLabel(a)]));
  const accountInstitutionById = new Map(accounts.map((a) => [a.id, a.institutionName]));
  const profiles = accessibleProfiles();
  const categories = transactionRepo.distinctCategories();
  const suggestions = getNameSuggestions(db);

  const tabs: BankTabData[] = [];
  for (const itemId of itemIds) {
    const item = itemRepo.getByItemId(itemId);
    if (!item) continue;

    const staged = stagingRepo.listByItem(itemId);
    const removals = removalsRepo.listByItem(itemId);

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

    tabs.push({
      itemId,
      institutionName: item.institutionName,
      rows,
      removalRows,
      matchedById: Object.fromEntries(matchedById),
    });
  }

  if (tabs.length === 0) redirect("/settings/plaid");

  return (
    <main style={{ padding: "2rem", maxWidth: 1400, margin: "0 auto", width: "100%" }}>
      <div style={{ marginBottom: "0.75rem" }}>
        <Link
          href={backHref}
          style={{ fontSize: 14, color: "#1a1f3a", textDecoration: "none" }}
        >
          {backLabel}
        </Link>
      </div>
      <h1 style={{ fontSize: "1.625rem", margin: "0 0 0.25rem" }}>
        Review synced transactions
      </h1>
      <div style={{ fontSize: 14, opacity: 0.7, marginBottom: "1.25rem" }}>
        {tabs.length} bank{tabs.length === 1 ? "" : "s"} synced. Review each tab below.
      </div>
      <ReviewAllClient
        tabs={tabs}
        categories={categories}
        profiles={profiles}
        canonicalSuggestions={suggestions.canonical}
        customSuggestions={suggestions.custom}
        customByCanonical={suggestions.customByCanonical}
      />
    </main>
  );
}
