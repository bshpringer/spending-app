import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db.ts";
import { getPlaidClient } from "@/lib/plaid/client.ts";
import { makePlaidItemRepo } from "@/lib/repo/plaidItemRepo.ts";
import { makeAccountRepo } from "@/lib/repo/accountRepo.ts";
import { accountNaturalKey } from "@/lib/csv-import.ts";
import { defaultGroupFromPlaid } from "@/lib/accountGroups.ts";

export const dynamic = "force-dynamic";

interface ReconcileMapping {
  plaidAccountId: string;
  action: "create" | "merge";
  existingAccountId?: string; // required when action === "merge"
}

interface ReconcileRequest {
  itemId: string;
  mappings: ReconcileMapping[];
}

function plaidTypeToAccountType(type: string, subtype: string | null): string {
  if (type === "credit") return "Credit Card";
  if (type === "depository") return "Cash";
  if (type === "investment") return "Investment";
  if (type === "loan") return "Loan";
  if (subtype) return capitalize(subtype);
  return capitalize(type);
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ReconcileRequest;
    if (!body.itemId || !Array.isArray(body.mappings)) {
      return NextResponse.json(
        { ok: false, error: "Missing itemId or mappings" },
        { status: 400 },
      );
    }
    const db = getDb();
    const itemRepo = makePlaidItemRepo(db);
    const accountRepo = makeAccountRepo(db);
    const item = itemRepo.getByItemId(body.itemId);
    const accessToken = itemRepo.getAccessToken(body.itemId);
    if (!item || !accessToken) {
      return NextResponse.json(
        { ok: false, error: "Item not found" },
        { status: 404 },
      );
    }

    // Fetch fresh account details from Plaid so we have institution + mask info
    // for any "create" actions.
    const client = getPlaidClient();
    const accountsResp = await client.accountsGet({ access_token: accessToken });
    const plaidAccountById = new Map(
      accountsResp.data.accounts.map((a) => [a.account_id, a] as const),
    );

    for (const mapping of body.mappings) {
      const plaidAccount = plaidAccountById.get(mapping.plaidAccountId);
      if (!plaidAccount) {
        return NextResponse.json(
          { ok: false, error: `Plaid account ${mapping.plaidAccountId} not found` },
          { status: 400 },
        );
      }

      let accountId: string;
      if (mapping.action === "merge") {
        if (!mapping.existingAccountId) {
          return NextResponse.json(
            { ok: false, error: "merge requires existingAccountId" },
            { status: 400 },
          );
        }
        const existing = accountRepo.findById(mapping.existingAccountId);
        if (!existing) {
          return NextResponse.json(
            { ok: false, error: `Account ${mapping.existingAccountId} not found` },
            { status: 400 },
          );
        }
        accountId = existing.id;
      } else {
        const institutionName = item.institutionName ?? "Unknown bank";
        const last4 = plaidAccount.mask ?? "";
        const naturalKey = accountNaturalKey(institutionName, last4);
        const created = accountRepo.getOrCreate({
          accountName: plaidAccount.name,
          accountNumberLast4: last4,
          institutionName,
          accountType: plaidTypeToAccountType(
            String(plaidAccount.type),
            plaidAccount.subtype ? String(plaidAccount.subtype) : null,
          ),
          accountGroup: defaultGroupFromPlaid(
            String(plaidAccount.type),
            plaidAccount.subtype ? String(plaidAccount.subtype) : null,
          ),
          naturalKey,
        });
        accountId = created.id;
      }

      itemRepo.linkAccount({
        plaidAccountId: mapping.plaidAccountId,
        itemId: body.itemId,
        accountId,
      });
    }

    revalidatePath("/settings/plaid");
    revalidatePath("/settings/accounts");
    return NextResponse.json({ ok: true });
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
