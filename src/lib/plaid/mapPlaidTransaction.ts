import type { Transaction as PlaidTransaction } from "plaid";
import type { ParsedTransaction, TransactionPlaidRaw } from "../types.ts";
import { accountNaturalKey } from "../csv-import.ts";

/**
 * Map a Plaid transaction into our internal ParsedTransaction shape so it can
 * flow through the same `transactionRepo.bulkUpsert` plumbing the CSV importer
 * uses. Sign is flipped to match our convention (negative = expense).
 *
 * Caller must supply the institutionName + accountNumberLast4 for the Plaid
 * sub-account so the naturalKey lines up with the existing account row.
 */
export function mapPlaidTransaction(
  txn: PlaidTransaction,
  ctx: { institutionName: string; accountNumberLast4: string },
): ParsedTransaction {
  const merchantName = txn.merchant_name?.trim();
  const name = merchantName && merchantName.length > 0 ? merchantName : txn.name;
  const description = txn.original_description?.trim() ?? "";
  const category =
    txn.personal_finance_category?.primary?.replace(/_/g, " ").toLowerCase() ?? "";
  // Use authorized_date when present (date the user actually made the txn),
  // falling back to the posted date.
  const originalDate = txn.authorized_date ?? txn.date;
  const csvAmount = txn.amount; // positive = money out, matches Rocket Money convention
  const signed = -csvAmount;
  const naturalKey = accountNaturalKey(ctx.institutionName, ctx.accountNumberLast4);
  // Plaid rows are uniquely identified by transaction_id. We do NOT use the
  // CSV-style dedupeKey (date|last4|amount|name|description) because:
  //   1. Two banks can issue the same last4 — Plaid sandbox guarantees this
  //      with its canned data; in production it's rare but not impossible.
  //   2. Cross-source (CSV ↔ Plaid) duplicate detection is handled explicitly
  //      by the staging fuzzy-match step in /api/plaid/sync, not by dedupeKey
  //      collision.
  // Scoping the key by plaidTransactionId guarantees uniqueness across all
  // sources and is stable across re-syncs.
  const dedupeKey = `plaid:${txn.transaction_id}`;
  return {
    dedupeKey,
    accountNaturalKey: naturalKey,
    date: txn.date,
    originalDate,
    name,
    amount: signed,
    csvAmount,
    description,
    category: titleCase(category),
    note: "",
    ignoredFrom: "",
    taxDeductible: false,
    tags: [],
    plaidTransactionId: txn.transaction_id,
    plaidRaw: extractPlaidRaw(txn),
    plaidRawFull: JSON.stringify(txn),
  };
}

/**
 * Curated subset of Plaid's full Transaction payload. We persist this on
 * `transactions.plaidRaw` so the pending→posted linker can key off the exact
 * `pending_transaction_id` Plaid sends, and the /duplicates UI can show
 * disambiguators (reference_number, authorized_datetime, payment_channel, …)
 * for pairs that genuinely look identical on the basic fields.
 */
export function extractPlaidRaw(txn: PlaidTransaction): TransactionPlaidRaw {
  const counterparties = Array.isArray(txn.counterparties) ? txn.counterparties : [];
  const counterpartyEntityIds = Array.from(
    new Set(
      counterparties
        .map((c) => (c as { entity_id?: string | null }).entity_id ?? null)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  );
  const location = txn.location ?? null;
  return {
    version: 1,
    pending: Boolean(txn.pending),
    pendingTransactionId: txn.pending_transaction_id ?? null,
    authorizedDate: txn.authorized_date ?? null,
    authorizedDatetime: txn.authorized_datetime ?? null,
    datetime: txn.datetime ?? null,
    paymentChannel: txn.payment_channel ?? null,
    merchantEntityId: (txn as { merchant_entity_id?: string | null }).merchant_entity_id ?? null,
    counterpartyEntityIds,
    logoUrl: txn.logo_url ?? null,
    website: txn.website ?? null,
    referenceNumber: txn.payment_meta?.reference_number ?? null,
    transactionCode: (txn.transaction_code as string | null | undefined) ?? null,
    checkNumber: txn.check_number ?? null,
    pfcDetailed: txn.personal_finance_category?.detailed ?? null,
    pfcConfidence:
      (txn.personal_finance_category as { confidence_level?: string | null } | null | undefined)
        ?.confidence_level ?? null,
    location: location
      ? {
          address: location.address ?? null,
          city: location.city ?? null,
          region: location.region ?? null,
          postalCode: location.postal_code ?? null,
          country: location.country ?? null,
          storeNumber: location.store_number ?? null,
        }
      : null,
  };
}

function titleCase(s: string): string {
  if (!s) return "";
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * The category Plaid originally assigned a transaction, recovered from the
 * stored verbatim `plaidRawFull` JSON. Mirrors the category derivation above so
 * the review UI can tell whether a merchant alias actually *overwrote* Plaid's
 * category (→ highlight) vs. merely restated it. Returns null when the JSON is
 * missing/unparseable or has no PFC primary.
 */
export function plaidCategoryFromRawFull(plaidRawFull: string | null): string | null {
  if (!plaidRawFull) return null;
  try {
    const txn = JSON.parse(plaidRawFull) as {
      personal_finance_category?: { primary?: string | null } | null;
    };
    const primary = txn.personal_finance_category?.primary;
    if (!primary) return null;
    return titleCase(primary.replace(/_/g, " ").toLowerCase());
  } catch {
    return null;
  }
}
