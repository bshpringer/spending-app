import type { Rule, RuleCondition, RuleEffects, Transaction } from "./types.ts";

function matchCondition(cond: RuleCondition, tx: Transaction): boolean {
  const { field, op, value } = cond;

  let txValue: string | number;
  switch (field) {
    case "category":
      txValue = tx.category;
      break;
    case "name":
      txValue = tx.customName ?? tx.name;
      break;
    case "canonicalName":
      txValue = tx.canonicalName ?? "";
      break;
    case "description":
      txValue = tx.description;
      break;
    case "accountId":
      txValue = tx.accountId ?? "";
      break;
    case "profileId":
      txValue = tx.profileId ?? "";
      break;
    case "amount":
      txValue = tx.amount;
      break;
    case "tag": {
      // true if the transaction has this tag (case-insensitive match on tag id)
      const needle = String(value).toLowerCase();
      const has = tx.tags.some((t) => t.toLowerCase() === needle);
      return op === "eq" ? has : !has;
    }
    default:
      return false;
  }

  switch (op) {
    case "eq":
      return String(txValue).toLowerCase() === String(value).toLowerCase();
    case "neq":
      return String(txValue).toLowerCase() !== String(value).toLowerCase();
    case "contains":
      return String(txValue).toLowerCase().includes(String(value).toLowerCase());
    case "gt":
      return Number(txValue) > Number(value);
    case "lt":
      return Number(txValue) < Number(value);
    case "in":
      return String(value)
        .split(",")
        .map((v) => v.trim().toLowerCase())
        .includes(String(txValue).toLowerCase());
    default:
      return false;
  }
}

export function matchesAll(conditions: RuleCondition[], tx: Transaction): boolean {
  return conditions.every((c) => matchCondition(c, tx));
}

/**
 * Pure function — no side effects, no DB access.
 * Rules are evaluated in priority order (already sorted by caller).
 * All matching rules apply; later rules can override earlier ones for
 * setCategory / setCustomName, and addTags/removeTags accumulate.
 */
export function evaluateRules(rules: Rule[], tx: Transaction): RuleEffects {
  return evaluateRulesWithTrace(rules, tx).effects;
}

export interface RuleEvalTrace {
  effects: RuleEffects;
  matched: { ruleId: string; ruleName: string }[];
}

/**
 * Same evaluator as {@link evaluateRules} but also returns the ordered list of
 * rules that matched (id + display name). Used by the Plaid review UI so we
 * can show a "Rule applied" badge and explain which rule contributed which
 * field. The effects object is identical to what `evaluateRules` returns.
 */
export function evaluateRulesWithTrace(rules: Rule[], tx: Transaction): RuleEvalTrace {
  const effects: RuleEffects = { exclude: false, oneTime: false, addTags: [], removeTags: [] };
  const matched: { ruleId: string; ruleName: string }[] = [];

  const enabled = rules
    .filter((r) => r.enabled)
    .sort((a, b) => a.priority - b.priority);

  for (const rule of enabled) {
    if (!matchesAll(rule.conditions, tx)) continue;
    matched.push({ ruleId: rule.id, ruleName: rule.name });

    for (const action of rule.actions) {
      switch (action.type) {
        case "exclude":
          effects.exclude = true;
          break;
        case "markOneTime":
          effects.oneTime = true;
          break;
        case "setCategory":
          if (action.value) effects.category = action.value;
          break;
        case "setCustomName":
          if (action.value) effects.customName = action.value;
          break;
        case "setCanonicalName":
          if (action.value) effects.canonicalName = action.value;
          break;
        case "setProfile":
          if (action.value) effects.profileId = action.value;
          break;
        case "setTags":
          // Replace the whole tag set. Empty value = clear all tags.
          effects.setTags = action.value ? [action.value] : [];
          break;
        case "addTag":
          if (action.value && !effects.addTags.includes(action.value)) {
            effects.addTags.push(action.value);
          }
          break;
        case "removeTag":
          if (action.value && !effects.removeTags.includes(action.value)) {
            effects.removeTags.push(action.value);
          }
          break;
      }
    }
  }

  return { effects, matched };
}

/**
 * Resolve a transaction's final tag set given rule effects. `setTags` (if the
 * `setTags` action ran) replaces the base entirely; then `removeTags` are
 * dropped and `addTags` appended. Shared by every apply path (aggregations,
 * Preview & apply, Plaid commit, CSV import preview) so the semantics stay
 * identical everywhere.
 */
export function resolveTags(
  currentTags: string[],
  effects: Pick<RuleEffects, "setTags" | "addTags" | "removeTags">,
): string[] {
  const base = effects.setTags !== undefined ? effects.setTags : currentTags;
  const removeSet = new Set((effects.removeTags ?? []).map((t) => t.toLowerCase()));
  const out = base.filter((t) => !removeSet.has(t.toLowerCase()));
  for (const t of effects.addTags ?? []) {
    if (!out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out;
}
