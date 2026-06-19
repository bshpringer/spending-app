#!/usr/bin/env node
// audit-public.mjs — fail-closed leak audit for the public-publish flow.
//
// Scans a target git tree (the exact files that would be published) for
// anything personal before it can reach the public repo. Four independent
// layers, any of which aborts the publish:
//
//   Layer 1  Forbidden-glob check  — no real-data / private-context files
//                                     (data/, *.db, scratch/, agent docs, .env*)
//   Layer 2  Denylist scan         — static identity terms (.publish-denylist)
//                                     + terms DERIVED LIVE from data/budgeting.db
//                                     (institutions, account & profile names)
//   Layer 3  Pattern scan          — emails, home paths (hard); long digit runs,
//                                     last-4s, merchant names (warn)
//   Layer 4  gitleaks              — secrets / tokens (e.g. Plaid access tokens)
//
// Design principle: FAIL CLOSED. A missing DB, a missing denylist, or a missing
// gitleaks binary is treated as a failure, not a skipped check — because the
// safe default of any mistake must be "nothing gets published."
//
// Usage:  node scripts/audit-public.mjs [targetDir]
//   targetDir  git working tree to scan (default: cwd). The file set is
//              `git ls-files` in that tree, so it inherently respects
//              .gitignore and excludes node_modules / .git.
//
// Env:
//   BUDGETING_DB_PATH   override path to the real DB (default <repoRoot>/data/budgeting.db)
//   AUDIT_ALLOW_NO_DB=1 escape hatch to scan with NO DB-derived terms (loud warning;
//                       only for trees with no DB available — use sparingly)

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, statSync, mkdtempSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import { resolve, join, dirname, extname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");

const targetDir = resolve(process.argv[2] ?? process.cwd());

// ── output helpers ─────────────────────────────────────────────────────────
const RED = "\x1b[31m", YEL = "\x1b[33m", GRN = "\x1b[32m", DIM = "\x1b[2m", RST = "\x1b[0m";
const hardFails = []; // {layer, file, detail}
const warnings = [];
function fail(layer, file, detail) { hardFails.push({ layer, file, detail }); }
function warn(layer, file, detail) { warnings.push({ layer, file, detail }); }
function abort(msg) {
  console.error(`${RED}✖ AUDIT ABORTED (fail-closed): ${msg}${RST}`);
  process.exit(2);
}

// ── target file set: exactly what git would publish ─────────────────────────
let files;
try {
  files = execFileSync("git", ["-C", targetDir, "ls-files"], { encoding: "utf8" })
    .split("\n").map((s) => s.trim()).filter(Boolean);
} catch {
  abort(`'${targetDir}' is not a git working tree (git ls-files failed).`);
}
if (files.length === 0) abort(`no tracked files found in '${targetDir}'.`);

const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".woff", ".woff2",
  ".ttf", ".eot", ".otf", ".db", ".sqlite", ".sqlite3", ".node", ".wasm", ".zip",
  ".gz", ".tgz", ".lock",
]);
function readText(rel) {
  const abs = join(targetDir, rel);
  if (!existsSync(abs)) return null;
  if (BINARY_EXT.has(extname(rel).toLowerCase())) return null;
  try {
    if (statSync(abs).size > 5_000_000) return null; // skip huge blobs
    const buf = readFileSync(abs);
    if (buf.includes(0)) return null; // binary
    return buf.toString("utf8");
  } catch { return null; }
}

// ── Layer 1: forbidden globs ────────────────────────────────────────────────
// These must never be in the published set even if someone force-added one.
const FORBIDDEN = [
  { re: /(^|\/)data\//, why: "real-data directory" },
  { re: /\.(db|sqlite|sqlite3)$/i, why: "SQLite database" },
  { re: /\.csv$/i, why: "CSV (possible real export)" },
  { re: /(^|\/)scratch\//, why: "private working-context dir" },
  { re: /(^|\/)\.claude\//, why: "Claude agent state" },
  { re: /(^|\/)\.env(\.(?!example$)[^/]*)?$/i, why: "env file (secrets)" }, // allows .env.example
  { re: /(^|\/)(AGENTS|CLAUDE|START_HERE|MAINTAINING)\.md$/, why: "private agent/maintainer doc" },
  { re: /(^|\/)\.publish-(deny|allow)list$/, why: "audit config (holds real terms)" },
];
for (const f of files) {
  for (const g of FORBIDDEN) {
    if (g.re.test(f)) fail("glob", f, g.why);
  }
}

// ── Layer 2 prep: build the denylist (static + DB-derived) ──────────────────
function parseListFile(path) {
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8").split("\n")
    .map((l) => l.replace(/#.*$/, "").trim()).filter(Boolean);
}

const STATIC_DENY = parseListFile(join(REPO_ROOT, ".publish-denylist"));
if (STATIC_DENY === null) {
  abort(".publish-denylist not found — refusing to publish without an active denylist.");
}
const ALLOW = new Set(
  (parseListFile(join(REPO_ROOT, ".publish-allowlist")) ?? []).map((s) => s.toLowerCase())
);

// DB-derived terms (live, always current with your real accounts)
const DB_PATH = process.env.BUDGETING_DB_PATH
  ? resolve(process.env.BUDGETING_DB_PATH)
  : join(REPO_ROOT, "data", "budgeting.db");

const dbHardTerms = new Set();   // institutions / account names / profile names
const dbWarnTerms = new Set();   // last-4s / merchant canonical names

if (existsSync(DB_PATH)) {
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  const pull = (sql, isWarn = false) => {
    let rows = [];
    try { rows = db.prepare(sql).all(); } catch { /* table may not exist */ }
    for (const r of rows) {
      for (const v of Object.values(r)) {
        if (v == null) continue;
        const term = String(v).trim();
        if (term.length < 3) continue;                 // too short → noisy
        if (!isWarn && ALLOW.has(term.toLowerCase())) continue; // generic word exception
        (isWarn ? dbWarnTerms : dbHardTerms).add(term);
      }
    }
  };
  pull("SELECT DISTINCT institutionName FROM accounts WHERE institutionName IS NOT NULL");
  pull("SELECT DISTINCT accountName FROM accounts WHERE accountName IS NOT NULL");
  pull("SELECT DISTINCT customName FROM accounts WHERE customName IS NOT NULL AND customName <> ''");
  pull("SELECT DISTINCT institutionName FROM plaid_items WHERE institutionName IS NOT NULL");
  pull("SELECT DISTINCT displayName FROM profiles WHERE displayName IS NOT NULL");
  pull("SELECT DISTINCT accountNumberLast4 FROM accounts WHERE accountNumberLast4 IS NOT NULL", true);
  pull("SELECT DISTINCT canonicalName FROM merchant_alias WHERE canonicalName IS NOT NULL", true);
  db.close();
} else if (process.env.AUDIT_ALLOW_NO_DB === "1") {
  console.error(`${YEL}⚠ AUDIT_ALLOW_NO_DB=1 — scanning with NO DB-derived terms. Static + pattern layers only.${RST}`);
} else {
  abort(`DB not found at ${DB_PATH}. Set BUDGETING_DB_PATH, or AUDIT_ALLOW_NO_DB=1 to override (not recommended).`);
}

// compile matchers
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// word-boundary-ish: term not flanked by another word char (handles multiword terms)
const mkTermRe = (term) => new RegExp(`(?<![A-Za-z0-9])${escape(term)}(?![A-Za-z0-9])`, "i");
const hardTerms = [
  ...STATIC_DENY.map((t) => ({ t, re: mkTermRe(t), src: "static" })),
  ...[...dbHardTerms].map((t) => ({ t, re: mkTermRe(t), src: "db" })),
];
const warnTerms = [...dbWarnTerms].map((t) => ({ t, re: mkTermRe(t), src: "db" }));

// ── Layer 3 patterns ────────────────────────────────────────────────────────
const HARD_PATTERNS = [
  { name: "email", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
  { name: "home path", re: /\/(Users|home)\/[A-Za-z0-9._-]+/ },
];
const WARN_PATTERNS = [
  { name: "long digit run (8+)", re: /\b\d{8,}\b/ },
];

// ── scan ────────────────────────────────────────────────────────────────────
for (const rel of files) {
  // .example env files are allowed to ship but scan them anyway for real values
  let text = readText(rel);
  if (text == null) continue;

  // Explicit safe strings that are allowed to bypass the denylist (e.g., the public github URL)
  const SAFE_STRINGS = [
    "https://github.com/bshpringer/spending-app.git"
  ];
  for (const safe of SAFE_STRINGS) {
    text = text.replaceAll(safe, "");
  }

  for (const { t, re, src } of hardTerms) {
    if (re.test(text)) fail("denylist", rel, `matched "${t}" (${src})`);
  }
  for (const { name, re } of HARD_PATTERNS) {
    const m = text.match(re);
    if (m) fail("pattern", rel, `${name}: ${m[0]}`);
  }
  for (const { t, re } of warnTerms) {
    if (re.test(text)) warn("denylist", rel, `matched "${t}" (db, warn-tier)`);
  }
  for (const { name, re } of WARN_PATTERNS) {
    const m = text.match(re);
    if (m) warn("pattern", rel, `${name}: ${m[0]}`);
  }
}

// ── Layer 4: gitleaks ────────────────────────────────────────────────────────
let gitleaksRan = false;
try {
  execFileSync("gitleaks", ["version"], { stdio: "ignore" });
} catch {
  abort("gitleaks not found on PATH. Install it (brew install gitleaks) — secret scanning is required.");
}
// CRITICAL: gitleaks `dir` walks the physical filesystem and does NOT respect
// .gitignore — pointing it at the repo root would recurse into node_modules
// (tens of thousands of files → pathological CPU/memory). Instead, materialize
// ONLY the git-tracked files (the exact publishable set, already in `files`)
// into a temp dir and scan that. node_modules / .next / data are never copied.
const scanDir = mkdtempSync(join(tmpdir(), "audit-gitleaks-"));
try {
  for (const rel of files) {
    const src = join(targetDir, rel);
    if (!existsSync(src)) continue;
    const dest = join(scanDir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
  }
  execFileSync("gitleaks", ["dir", scanDir, "--no-banner", "--redact"], { stdio: "pipe" });
  gitleaksRan = true;
} catch (e) {
  // gitleaks exits non-zero (default 1) when leaks are found, or other on usage error.
  const status = e.status;
  if (status === 1) {
    const out = (e.stdout?.toString() ?? "") + (e.stderr?.toString() ?? "");
    fail("gitleaks", "(repo)", `secrets detected:\n${out.split("\n").slice(0, 12).join("\n")}`);
    gitleaksRan = true;
  } else {
    abort(`gitleaks failed to run (exit ${status}). Output:\n${e.stderr?.toString() ?? e.message}`);
  }
} finally {
  rmSync(scanDir, { recursive: true, force: true });
}

// ── report ───────────────────────────────────────────────────────────────────
console.log(`\n${DIM}Audited ${files.length} tracked files in ${targetDir}${RST}`);
console.log(`${DIM}Denylist: ${STATIC_DENY.length} static + ${dbHardTerms.size} DB-derived hard, ${dbWarnTerms.size} warn-tier; gitleaks ${gitleaksRan ? "ran" : "DID NOT RUN"}${RST}`);

if (warnings.length) {
  console.log(`\n${YEL}⚠ ${warnings.length} warning(s) — review, but not blocking:${RST}`);
  for (const w of dedupe(warnings)) console.log(`  ${YEL}·${RST} [${w.layer}] ${w.file} — ${w.detail}`);
}

if (hardFails.length) {
  console.log(`\n${RED}✖ ${hardFails.length} BLOCKING violation(s) — publish refused:${RST}`);
  for (const f of dedupe(hardFails)) console.log(`  ${RED}✖${RST} [${f.layer}] ${f.file} — ${f.detail}`);
  console.log(`\n${RED}Fix every blocking violation before publishing.${RST}`);
  process.exit(1);
}

console.log(`\n${GRN}✓ Clean — no personal data, identifiers, or secrets in the publishable set.${RST}`);
process.exit(0);

function dedupe(list) {
  const seen = new Set(), out = [];
  for (const x of list) {
    const k = `${x.layer}|${x.file}|${x.detail}`;
    if (seen.has(k)) continue;
    seen.add(k); out.push(x);
  }
  return out;
}
