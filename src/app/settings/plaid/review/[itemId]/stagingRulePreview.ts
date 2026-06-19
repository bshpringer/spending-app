import { evaluateRulesWithTrace, resolveTags } from "@/lib/evaluate.ts";
import type { Rule, Transaction } from "@/lib/types.ts";
import { DEFAULT_PROFILE_ID } from "@/lib/constants.ts";

export interface RulePreviewEffects {
  category?: string;
  customName?: string;
  canonicalName?: string;
  excluded?: boolean;
  oneTime?: boolean;
  addTags?: string[];
  removeTags?: string[];
}

export interface RulePreview {
  matched: { ruleId: string; ruleName: string }[];
  effects: RulePreviewEffects;
}

interface StagedRowLike {
  accountId: string | null;
  profileId: string | null;
  date: string;
  originalDate: string | null;
  name: string;
  customName: string | null;
  canonicalName: string | null;
  amount: number;
  description: string;
  category: string;
  note: string;
  tags: string[];
}

// Build a Transaction-shaped stub from a staged row so the same rule evaluator
// that runs against committed transactions also applies cleanly here. Fields
// the evaluator doesn't read get sentinel values.
function stubFromStagedRow(row: StagedRowLike): Transaction {
  return {
    id: "",
    dedupeKey: "",
    accountId: row.accountId,
    profileId: row.profileId ?? DEFAULT_PROFILE_ID,
    date: row.date,
    originalDate: row.originalDate ?? row.date,
    name: row.name,
    customName: row.customName ?? undefined,
    canonicalName: row.canonicalName ?? undefined,
    amount: row.amount,
    csvAmount: row.amount,
    description: row.description,
    category: row.category,
    note: row.note,
    ignoredFrom: "",
    taxDeductible: false,
    tags: row.tags,
    userOverrides: {},
    importedFromCsvAt: "",
    importBatchId: null,
    source: "plaid",
    plaidRaw: null,
    createdAt: "",
    updatedAt: "",
  };
}

/**
 * Returns a {@link RulePreview} when at least one enabled rule matches the
 * staged row. Returns null when nothing matched — the UI can then skip
 * rendering the "Rule applied" badge entirely.
 */
export function previewRulesForStagedRow(
  rules: Rule[],
  row: StagedRowLike,
): RulePreview | null {
  const { effects, matched } = evaluateRulesWithTrace(rules, stubFromStagedRow(row));
  if (matched.length === 0) return null;

  // Carry every field the rule actually SETS — even when the value already
  // equals the current staged value. A rule that sets a field still *governs*
  // it (the field must read-only + pre-fill + show in the badge), and rules
  // override staged values at commit regardless. Stripping equal-to-current
  // values made redundant rules look like "no field changes" and left
  // rule-governed fields editable. (See issues #3/#4.)
  const preview: RulePreviewEffects = {};
  if (effects.category) preview.category = effects.category;
  if (effects.customName) preview.customName = effects.customName;
  if (effects.canonicalName) preview.canonicalName = effects.canonicalName;
  if (effects.exclude) preview.excluded = true;
  if (effects.oneTime) preview.oneTime = true;
  // Diff the resolved tag set against the row's current tags so `setTags`
  // (replace-all) shows up as the right + / − changes, and so commit-batch's
  // add/remove merge reproduces the resolved set exactly.
  const finalTags = resolveTags(row.tags, effects);
  const lower = (xs: string[]) => xs.map((t) => t.toLowerCase());
  const currentLower = lower(row.tags);
  const finalLower = lower(finalTags);
  const addTags = finalTags.filter((t) => !currentLower.includes(t.toLowerCase()));
  if (addTags.length > 0) preview.addTags = addTags;
  const removeTags = row.tags.filter((t) => !finalLower.includes(t.toLowerCase()));
  if (removeTags.length > 0) preview.removeTags = removeTags;

  return { matched, effects: preview };
}
