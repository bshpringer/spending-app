// Feature flags that distinguish the public template build from a private one.
//
// The committed default is the PUBLIC experience: a clean, Plaid-first app with
// CSV import, cross-source (CSV↔Plaid) reconciliation, and one-time migration
// tooling all hidden. A private deployment opts into the full feature set by
// setting NEXT_PUBLIC_APP_MODE=private in .env.local (gitignored).
//
// Why "public" is the default: the same code ships to the public repo, and a
// fresh clone should show the intended generic experience with zero env setup.
// The private app overrides via .env.local — mirroring how DEFAULT_USER_ID works
// (see constants.ts). The routes/components behind these flags still exist and
// work if re-enabled; the flags only control whether their entry points render.
//
// NEXT_PUBLIC_ prefix is required so client components (SettingsMenu, BanksClient)
// can read it — non-public env vars are undefined in the browser bundle.
// Like all env vars here, it is read at dev-server startup; restart after editing.

const mode = process.env.NEXT_PUBLIC_APP_MODE ?? "public";

/** True for the private (full-feature) deployment; false for the public template. */
export const IS_PRIVATE_BUILD = mode === "private";

export const FEATURES = {
  /** CSV import (Rocket Money exports etc.) — entry points in nav + empty states. */
  csvImport: IS_PRIVATE_BUILD,
  /** Cross-source CSV↔Plaid row reconciliation (/reconcile). */
  crossSourceReconcile: IS_PRIVATE_BUILD,
  /** One-time migration tooling: reference pull, raw-payload backfill, merchant reconcile section. */
  migrationTooling: IS_PRIVATE_BUILD,
} as const;
