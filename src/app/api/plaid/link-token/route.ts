import { NextResponse } from "next/server";
import { CountryCode, Products } from "plaid";
import { getPlaidClient } from "@/lib/plaid/client.ts";
import { DEFAULT_USER_ID } from "@/lib/constants.ts";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const client = getPlaidClient();
    const resp = await client.linkTokenCreate({
      client_name: "Budget",
      country_codes: [CountryCode.Us],
      language: "en",
      user: { client_user_id: DEFAULT_USER_ID },
      products: [Products.Transactions],
      // Default is 90 days. 730 is Plaid's documented cap for the Transactions
      // product and unlocks meaningful historical backfill via /transactions/get.
      // Existing Items keep whatever window they were linked with — they must be
      // unlinked and relinked to pick up the wider window.
      transactions: { days_requested: 730 },
    });
    return NextResponse.json({ ok: true, link_token: resp.data.link_token });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: errorMessage(err) },
      { status: 500 },
    );
  }
}

function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return "Unknown error";
}
