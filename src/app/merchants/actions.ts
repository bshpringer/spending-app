"use server";

import { getDb } from "../../lib/db.ts";
import { makeRefundMatchRepo } from "../../lib/repo/refundMatchRepo.ts";
import { makeTransactionRepo } from "../../lib/repo/transactionRepo.ts";
import { buildLinkedRefundRows } from "../../lib/refundNetting.ts";
import type { CategoryTxRow, CategoryTxPage } from "../../lib/categoryDateRange.ts";

export async function getMerchantTransactionsPage(
  merchant: string,
  from: string | null,
  to: string | null,
  offset: number,
  limit: number,
  profileIds: string[] | null = null,
  sortKey: "date" | "name" | "amount" | null = null,
  sortDir: "asc" | "desc" = "desc",
): Promise<CategoryTxPage> {
  const db = getDb();
  const refundMatchRepo = makeRefundMatchRepo(db);
  const allPairs = refundMatchRepo.allConfirmedPairs();
  const refundIds = allPairs.map((p) => p.refundId);

  const conds: string[] = [];
  const params: unknown[] = [];

  conds.push("COALESCE(NULLIF(t.canonicalName, ''), NULLIF(t.customName, ''), t.name) = ?");
  params.push(merchant);

  if (from) {
    conds.push("COALESCE(NULLIF(t.originalDate, ''), t.date) >= ?");
    params.push(from);
  }
  if (to) {
    conds.push("COALESCE(NULLIF(t.originalDate, ''), t.date) <= ?");
    params.push(to);
  }
  if (profileIds && profileIds.length > 0) {
    conds.push(`t.profileId IN (${profileIds.map(() => "?").join(",")})`);
    params.push(...profileIds);
  }
  // Suppress confirmed refunds from the top-level page set — nested as children only.
  if (refundIds.length > 0) {
    conds.push(`t.id NOT IN (${refundIds.map(() => "?").join(",")})`);
    params.push(...refundIds);
  }
  const where = conds.join(" AND ");

  const totalRow = db.prepare(`SELECT COUNT(*) as c FROM transactions t WHERE ${where}`).get(...params) as { c: number };

  const dateExpr = "COALESCE(NULLIF(t.originalDate, ''), t.date)";
  // When the user clicks a column header, sort the WHOLE matching set in SQL
  // (then paginate) — not just the current page. Default = newest first.
  function buildOrderBy(): string {
    if (sortKey) {
      const dir = sortDir === "desc" ? "DESC" : "ASC";
      const nameExpr = "LOWER(COALESCE(NULLIF(t.customName, ''), NULLIF(t.canonicalName, ''), t.name))";
      switch (sortKey) {
        case "date": return `${dateExpr} ${dir}, t.id DESC`;
        case "name": return `${nameExpr} ${dir}, ${dateExpr} DESC, t.id DESC`;
        case "amount": return `t.amount ${dir}, ${dateExpr} DESC, t.id DESC`;
      }
    }
    return `${dateExpr} DESC, t.id DESC`;
  }
  const orderBy = buildOrderBy();

  const rows = db.prepare(
    `SELECT t.id, t.date, t.originalDate, t.name, t.customName, t.canonicalName, t.amount, t.category, t.note, t.accountId, t.profileId,
            IFNULL(json_extract(t.userOverrides, '$.excluded'), 0) as excludedFlag,
            IFNULL(json_extract(t.userOverrides, '$.oneTime'), 0) as oneTimeFlag,
            (SELECT json_group_array(tagId) FROM transaction_tags WHERE transactionId = t.id) as tags
     FROM transactions t WHERE ${where}
     ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset) as {
    id: string;
    date: string;
    originalDate: string | null;
    name: string;
    customName: string | null;
    canonicalName: string | null;
    amount: number;
    category: string;
    note: string;
    tags: string;
    excludedFlag: number;
    oneTimeFlag: number;
    accountId: string | null;
    profileId: string | null;
  }[];

  const mappedRows: CategoryTxRow[] = rows.map((r) => ({
    id: r.id,
    date: r.originalDate || r.date,
    originalDate: r.originalDate ?? undefined,
    name: r.name,
    customName: r.customName ?? undefined,
    canonicalName: r.canonicalName ?? undefined,
    category: r.category,
    amount: r.amount,
    note: r.note,
    tags: JSON.parse(r.tags) as string[],
    excluded: r.excludedFlag === 1,
    oneTime: r.oneTimeFlag === 1,
    accountId: r.accountId,
    profileId: r.profileId ?? undefined,
  }));

  const txRepo = makeTransactionRepo(db);
  const visibleExpenseIds = new Set(mappedRows.map((r) => r.id));
  const linkedRefundsMap = buildLinkedRefundRows(visibleExpenseIds, allPairs, txRepo);
  const linkedRefunds: Record<string, CategoryTxRow[]> = Object.fromEntries(
    Array.from(linkedRefundsMap.entries()).map(([expenseId, rs]) => [
      expenseId,
      rs as unknown as CategoryTxRow[],
    ]),
  );

  return { rows: mappedRows, total: totalRow.c, linkedRefunds };
}
