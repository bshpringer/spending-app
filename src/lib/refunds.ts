import { effectiveTransactions } from "./aggregations.ts";
import type { Transaction, Rule, Category } from "./types.ts";

export type RefundConfidence = "high" | "low";

export interface RefundSuggestion {
  expense: Transaction;
  refund: Transaction;
  confidence: RefundConfidence;
  reason: string;
  daysBetween: number;
}

export interface RefundDetectOptions {
  windowDays?: number;
  today?: string;
}

const DEFAULT_WINDOW_DAYS = 60;

function pairKey(expenseId: string, refundId: string): string {
  return `${expenseId}|${refundId}`;
}

function daysBetween(from: string, to: string): number {
  const a = new Date(from + "T00:00:00Z").getTime();
  const b = new Date(to + "T00:00:00Z").getTime();
  return Math.round((b - a) / 86400000);
}

function merchantKey(tx: Transaction): string {
  return (tx.customName ?? tx.canonicalName ?? tx.name).trim().toLowerCase();
}

// Collect every transaction id that already participates in a confirmed pair —
// either side. Used to drop candidates that the user has already accounted for.
function usedTxIds(confirmedPairs: Set<string>): Set<string> {
  const used = new Set<string>();
  for (const key of confirmedPairs) {
    const [e, r] = key.split("|");
    if (e) used.add(e);
    if (r) used.add(r);
  }
  return used;
}

export function detectRefunds(
  transactions: Transaction[],
  rules: Rule[],
  categoryMap: Map<string, Category>,
  accountTagMap: Map<string, string[]>,
  confirmedPairs: Set<string>,
  rejectedPairs: Set<string>,
  options: RefundDetectOptions = {},
): RefundSuggestion[] {
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;

  // Reuse the canonical rules+overrides gate. effectiveTransactions drops
  // excluded transactions and ignored-classification categories. Refunds in
  // expense categories survive — which is what we want here.
  const effective = effectiveTransactions(transactions, rules, categoryMap, accountTagMap);

  const used = usedTxIds(confirmedPairs);

  // Build per-account pools. Auto-detect requires same account on both sides
  // AND non-null accountId; manual-link in the UI bypasses these rules.
  const expensesByAccount = new Map<string, Transaction[]>();
  const refundsByAccount = new Map<string, Transaction[]>();
  for (const tx of effective) {
    if (!tx.accountId) continue;
    if (used.has(tx.id)) continue;
    if (tx.amount < 0) {
      const arr = expensesByAccount.get(tx.accountId) ?? [];
      arr.push(tx);
      expensesByAccount.set(tx.accountId, arr);
    } else if (tx.amount > 0) {
      const arr = refundsByAccount.get(tx.accountId) ?? [];
      arr.push(tx);
      refundsByAccount.set(tx.accountId, arr);
    }
  }

  const suggestions: RefundSuggestion[] = [];
  for (const [accountId, refunds] of refundsByAccount) {
    const expenses = expensesByAccount.get(accountId) ?? [];
    if (expenses.length === 0) continue;

    for (const refund of refunds) {
      for (const expense of expenses) {
        if (Math.abs(expense.amount) !== refund.amount) continue;
        const delta = daysBetween(expense.date, refund.date);
        // Allow the refund to post up to 2 days BEFORE the expense — bank
        // posting order isn't always settle-date ordered, so a refund-then-
        // charge sequence at the same merchant can flip.
        if (delta < -2) continue;
        if (delta > windowDays) continue;

        const key = pairKey(expense.id, refund.id);
        if (confirmedPairs.has(key)) continue;
        if (rejectedPairs.has(key)) continue;

        const sameMerchant = merchantKey(expense) === merchantKey(refund);
        const confidence: RefundConfidence = sameMerchant ? "high" : "low";
        const absDelta = Math.abs(delta);
        const dayWord = absDelta === 1 ? "1d" : `${absDelta}d`;
        const reason = sameMerchant
          ? `same merchant, exact amount, ${dayWord} apart`
          : `different merchant, exact amount, same account, ${dayWord} apart`;

        suggestions.push({ expense, refund, confidence, reason, daysBetween: delta });
      }
    }
  }

  // Stable sort: high confidence first, then most recent refund.
  suggestions.sort((a, b) => {
    if (a.confidence !== b.confidence) return a.confidence === "high" ? -1 : 1;
    return b.refund.date.localeCompare(a.refund.date);
  });

  return suggestions;
}

export { pairKey };
