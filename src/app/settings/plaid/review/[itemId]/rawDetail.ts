import type { TransactionPlaidRaw } from "@/lib/types.ts";

/** One named party to the transaction (merchant, marketplace, bank, app, …). */
export interface RawCounterparty {
  name: string;
  type: string | null;
}

/** Transfer/bill-pay metadata — payer/payee/method for Zelle, ACH, etc. */
export interface RawPaymentMeta {
  payer: string | null;
  payee: string | null;
  paymentMethod: string | null;
  paymentProcessor: string | null;
  reason: string | null;
  byOrderOf: string | null;
}

/**
 * The curated bundle the review-page hover card renders. Combines the already-
 * parsed {@link TransactionPlaidRaw} with the two high-signal fields that only
 * live in the verbatim `plaidRawFull` JSON (named counterparties + payment_meta).
 */
export interface RawDetail {
  authorizedDate: string | null;
  authorizedDatetime: string | null;
  pending: boolean;
  pendingTransactionId: string | null;
  paymentChannel: string | null;
  referenceNumber: string | null;
  counterparties: RawCounterparty[];
  paymentMeta: RawPaymentMeta | null;
}

export function buildRawDetail(
  plaidRaw: TransactionPlaidRaw | null,
  plaidRawFull: string | null,
): RawDetail | null {
  if (!plaidRaw && !plaidRawFull) return null;

  let counterparties: RawCounterparty[] = [];
  let paymentMeta: RawPaymentMeta | null = null;

  if (plaidRawFull) {
    try {
      const txn = JSON.parse(plaidRawFull) as {
        counterparties?: { name?: string | null; type?: string | null }[] | null;
        payment_meta?: {
          payer?: string | null;
          payee?: string | null;
          payment_method?: string | null;
          payment_processor?: string | null;
          reason?: string | null;
          by_order_of?: string | null;
        } | null;
      };
      if (Array.isArray(txn.counterparties)) {
        counterparties = txn.counterparties
          .filter((c): c is { name: string; type?: string | null } => !!c && !!c.name)
          .map((c) => ({ name: String(c.name), type: c.type ?? null }));
      }
      const pm = txn.payment_meta;
      if (
        pm &&
        (pm.payer || pm.payee || pm.payment_method || pm.payment_processor || pm.reason || pm.by_order_of)
      ) {
        paymentMeta = {
          payer: pm.payer ?? null,
          payee: pm.payee ?? null,
          paymentMethod: pm.payment_method ?? null,
          paymentProcessor: pm.payment_processor ?? null,
          reason: pm.reason ?? null,
          byOrderOf: pm.by_order_of ?? null,
        };
      }
    } catch {
      // Malformed JSON — fall back to whatever plaidRaw provides.
    }
  }

  return {
    authorizedDate: plaidRaw?.authorizedDate ?? null,
    authorizedDatetime: plaidRaw?.authorizedDatetime ?? null,
    pending: plaidRaw?.pending ?? false,
    pendingTransactionId: plaidRaw?.pendingTransactionId ?? null,
    paymentChannel: plaidRaw?.paymentChannel ?? null,
    referenceNumber: plaidRaw?.referenceNumber ?? null,
    counterparties,
    paymentMeta,
  };
}
