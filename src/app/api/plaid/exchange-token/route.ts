import { NextResponse } from "next/server";
import { CountryCode } from "plaid";
import { getDb } from "@/lib/db.ts";
import { getPlaidClient } from "@/lib/plaid/client.ts";
import { makePlaidItemRepo } from "@/lib/repo/plaidItemRepo.ts";

export const dynamic = "force-dynamic";

interface PlaidAccountSummary {
  account_id: string;
  name: string;
  official_name: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { public_token?: string };
    if (!body.public_token) {
      return NextResponse.json(
        { ok: false, error: "Missing public_token" },
        { status: 400 },
      );
    }
    const client = getPlaidClient();
    const exchange = await client.itemPublicTokenExchange({
      public_token: body.public_token,
    });
    const accessToken = exchange.data.access_token;
    const itemId = exchange.data.item_id;

    // Fetch the Item to pick up the institution_id, then the institution name.
    const itemResp = await client.itemGet({ access_token: accessToken });
    const institutionId = itemResp.data.item.institution_id ?? null;
    let institutionName: string | null = null;
    if (institutionId) {
      const inst = await client.institutionsGetById({
        institution_id: institutionId,
        country_codes: [CountryCode.Us],
      });
      institutionName = inst.data.institution.name;
    }

    // Pull the account list so the reconciliation UI has something to show.
    const accountsResp = await client.accountsGet({ access_token: accessToken });
    const accounts: PlaidAccountSummary[] = accountsResp.data.accounts.map((a) => ({
      account_id: a.account_id,
      name: a.name,
      official_name: a.official_name ?? null,
      mask: a.mask ?? null,
      type: String(a.type),
      subtype: a.subtype ? String(a.subtype) : null,
    }));

    const db = getDb();
    const repo = makePlaidItemRepo(db);
    repo.create({
      itemId,
      accessToken,
      institutionId,
      institutionName,
    });

    return NextResponse.json({
      ok: true,
      itemId,
      institutionName,
      accounts,
    });
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
