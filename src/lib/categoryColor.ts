// Shared category color logic so a category looks the same everywhere
// (Categories index, Trends breakdown, etc).
//
// A category can have an explicit color the user picked. When it doesn't, we
// derive a STABLE color from its name (hash → palette) instead of a positional
// one — so the same category always gets the same color across every page,
// and two pages never disagree.

export const CATEGORY_PALETTE = [
  "#6366f1", "#f59e0b", "#ef4444", "#10b981",
  "#3b82f6", "#f97316", "#8b5cf6", "#06b6d4",
  "#84cc16", "#ec4899", "#64748b", "#a16207",
];

/** Explicit color if set, otherwise a deterministic palette color from the name. */
export function categoryColor(name: string, stored?: string | null): string {
  if (stored) return stored;
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  return CATEGORY_PALETTE[h % CATEGORY_PALETTE.length];
}
