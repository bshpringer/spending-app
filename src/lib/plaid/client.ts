import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
} from "plaid";

let cached: PlaidApi | null = null;

function envName(): "sandbox" | "production" {
  const raw = (process.env.PLAID_ENV ?? "sandbox").toLowerCase();
  if (raw === "production") return "production";
  return "sandbox";
}

export function plaidEnv(): "sandbox" | "production" {
  return envName();
}

export function getPlaidClient(): PlaidApi {
  if (cached) return cached;
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  if (!clientId || !secret) {
    throw new Error(
      "Plaid is not configured. Set PLAID_CLIENT_ID and PLAID_SECRET in .env.local.",
    );
  }
  const basePath = PlaidEnvironments[envName()];
  const config = new Configuration({
    basePath,
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": clientId,
        "PLAID-SECRET": secret,
      },
    },
  });
  cached = new PlaidApi(config);
  return cached;
}
