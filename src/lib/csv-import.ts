import type {
  CsvParseResult,
  ParsedAccount,
  ParsedTransaction,
} from "./types";

const EXPECTED_HEADERS = [
  "Date",
  "Original Date",
  "Account Type",
  "Account Name",
  "Account Number",
  "Institution Name",
  "Name",
  "Custom Name",
  "Amount",
  "Description",
  "Category",
  "Note",
  "Ignored From",
  "Tax Deductible",
  "Transaction Tags",
] as const;

const MOJIBAKE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/Â®/g, "®"],
  [/Â©/g, "©"],
  [/Â/g, ""],
  [/â€™/g, "’"],
  [/â€"/g, "—"],
  [/â€œ/g, "“"],
  [/â€/g, "”"],
];

export function sanitizeText(value: string): string {
  let out = value;
  for (const [pattern, replacement] of MOJIBAKE_REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }
  return out.trim();
}

export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === ",") {
        fields.push(current);
        current = "";
      } else if (ch === '"') {
        inQuotes = true;
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

export function splitCsvRows(text: string): string[] {
  const rows: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        current += '""';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      current += ch;
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      if (current.length > 0) {
        rows.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current.length > 0) rows.push(current);
  return rows;
}

function normalizeDate(raw: string): string {
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, mm, dd, yyyy] = slashMatch;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  return trimmed;
}

function lastFour(accountNumber: string): string {
  const digits = accountNumber.replace(/\D/g, "");
  if (digits.length >= 4) return digits.slice(-4);
  return digits || accountNumber.trim();
}

function parseAmount(raw: string): { csvAmount: number; signed: number } {
  const cleaned = raw.replace(/[,$\s]/g, "");
  const num = Number(cleaned);
  if (!Number.isFinite(num)) {
    return { csvAmount: 0, signed: 0 };
  }
  return { csvAmount: num, signed: -num };
}

function parseBoolean(raw: string): boolean {
  const v = raw.trim().toLowerCase();
  return v === "true" || v === "yes" || v === "y" || v === "1";
}

function parseTags(raw: string): string[] {
  if (!raw.trim()) return [];
  return raw
    .split(/[,;|]/)
    .map((t) => sanitizeText(t))
    .filter((t) => t.length > 0);
}

export function slugifyTag(displayName: string): string {
  return displayName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function accountNaturalKey(
  institutionName: string,
  accountNumberLast4: string,
): string {
  return `${slugifyTag(institutionName)}::${accountNumberLast4}`;
}

export function makeDedupeKey(
  originalDate: string,
  accountNumberLast4: string,
  csvAmount: number,
  name: string,
  description: string,
): string {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  return [
    originalDate,
    accountNumberLast4,
    csvAmount.toFixed(2),
    norm(name),
    norm(description),
  ].join("|");
}

export function parseCsv(text: string): CsvParseResult {
  const warnings: string[] = [];
  const rows = splitCsvRows(text);
  if (rows.length === 0) {
    return { transactions: [], accounts: [], tagDisplayNames: [], collisions: [], warnings: ["Empty file"] };
  }

  const headerLine = rows[0];
  const headers = parseCsvLine(headerLine).map((h) => sanitizeText(h));
  const missing = EXPECTED_HEADERS.filter((h) => !headers.includes(h));
  if (missing.length > 0) {
    warnings.push(`Missing expected columns: ${missing.join(", ")}`);
  }
  const idx = (name: string) => headers.indexOf(name);

  const transactions: ParsedTransaction[] = [];
  const accountMap = new Map<string, ParsedAccount>();
  const tagSet = new Map<string, string>();

  for (let r = 1; r < rows.length; r++) {
    const raw = rows[r];
    if (!raw.trim()) continue;
    const cols = parseCsvLine(raw).map(sanitizeText);
    if (cols.every((c) => c === "")) continue;

    const accountName = cols[idx("Account Name")] ?? "";
    const accountType = cols[idx("Account Type")] ?? "";
    const accountNumberRaw = cols[idx("Account Number")] ?? "";
    const institutionName = cols[idx("Institution Name")] ?? "";
    const accountNumberLast4 = lastFour(accountNumberRaw);
    const naturalKey = accountNaturalKey(institutionName, accountNumberLast4);

    if (!accountMap.has(naturalKey)) {
      accountMap.set(naturalKey, {
        accountName,
        accountNumberLast4,
        institutionName,
        accountType,
        naturalKey,
      });
    }

    const category = cols[idx("Category")] ?? "";
    const { csvAmount, signed } = parseAmount(cols[idx("Amount")] ?? "");
    const date = normalizeDate(cols[idx("Date")] ?? "");
    const originalDate = normalizeDate(cols[idx("Original Date")] ?? "");
    const name = cols[idx("Name")] ?? "";
    const description = cols[idx("Description")] ?? "";
    const tags = parseTags(cols[idx("Transaction Tags")] ?? "");

    for (const t of tags) {
      const slug = slugifyTag(t);
      if (!tagSet.has(slug)) tagSet.set(slug, t);
    }

    transactions.push({
      dedupeKey: makeDedupeKey(originalDate, accountNumberLast4, csvAmount, name, description),
      accountNaturalKey: naturalKey,
      date,
      originalDate,
      name,
      amount: signed,
      csvAmount,
      description,
      category,
      note: cols[idx("Note")] ?? "",
      ignoredFrom: cols[idx("Ignored From")] ?? "",
      taxDeductible: parseBoolean(cols[idx("Tax Deductible")] ?? ""),
      tags,
    });
  }

  // Group by base key (pre-suffix) so we can both report collisions AND
  // assign a stable per-occurrence #N suffix that lets all rows persist.
  // Rocket Money exports same-day repeats (e.g. subway swipes, Amazon dupes)
  // that share every meaningful field — without the suffix they'd collapse to one row.
  const byBaseKey = new Map<string, ParsedTransaction[]>();
  for (const tx of transactions) {
    const list = byBaseKey.get(tx.dedupeKey);
    if (list) list.push(tx);
    else byBaseKey.set(tx.dedupeKey, [tx]);
  }
  const collisions = Array.from(byBaseKey.entries())
    .filter(([, rows]) => rows.length > 1)
    .map(([dedupeKey, rows]) => ({ dedupeKey, rows }));

  // Apply #N suffix to EVERY row (not just colliding ones) so the keys stay
  // stable on re-import. If a future re-export introduces a new same-key row,
  // existing rows keep their #1/#2/... assignments.
  for (const [base, rows] of byBaseKey) {
    rows.forEach((tx, i) => {
      tx.dedupeKey = `${base}#${i + 1}`;
    });
  }

  if (collisions.length > 0) {
    warnings.push(
      `${collisions.length} duplicate-key group(s) within this file — same date, account, amount, name, and description. All rows are kept (stable #N suffix); review the list to spot any actual double-charges.`,
    );
  }

  return {
    transactions,
    accounts: Array.from(accountMap.values()),
    tagDisplayNames: Array.from(tagSet.values()),
    warnings,
    collisions,
  };
}
