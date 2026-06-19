// App-wide identity defaults.
//
// This app has no real auth — it runs as a single local user. Out of the box it
// ships with one user ("me") and one profile ("household"). If you want to model
// multiple people (e.g. a shared-household vs. personal split), add more profiles
// from the Profiles settings page; these constants are only the first-run seed
// defaults and the fallback for rows that somehow have no profile.
//
// A private deployment that was seeded with a different user id can override it
// via DEFAULT_USER_ID in .env.local (gitignored) — so the committed code stays
// generic while the real id never gets committed. DEFAULT_USER_ID is used only
// in server code (auth, Plaid link-token), so a plain env var is sufficient
// (no NEXT_PUBLIC_ prefix needed). Restart the dev server after editing .env.local.

/** The default profile every transaction/account falls back to. Generic + audit-safe. */
export const DEFAULT_PROFILE_ID = "household";

/** The single local user. Override via DEFAULT_USER_ID in .env.local for an existing DB. */
export const DEFAULT_USER_ID = process.env.DEFAULT_USER_ID ?? "me";
