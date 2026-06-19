import { makeProfileRepo } from "./repo/profileRepo.ts";
import { getDb } from "./db.ts";
import { DEFAULT_USER_ID } from "./constants.ts";

export function currentUserId(): string {
  return DEFAULT_USER_ID;
}

export function accessibleProfileIds(): string[] {
  return makeProfileRepo(getDb()).accessibleIds(currentUserId());
}

export function accessibleProfiles() {
  return makeProfileRepo(getDb()).listForUser(currentUserId());
}

/**
 * Resolve the `?profile=` URL param into a concrete profileIds filter.
 * - "all" / undefined → null (no filter; caller passes nothing to query)
 * - specific id → [id] if accessible, otherwise null (silently fall back to all)
 */
export function resolveProfileFilter(raw: string | undefined): string[] | null {
  if (!raw || raw === "all") return null;
  const accessible = accessibleProfileIds();
  if (!accessible.includes(raw)) return null;
  return [raw];
}

