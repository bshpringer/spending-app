#!/usr/bin/env bash
# publish-public.sh — build the public template as a zero-history orphan commit
# and push it to the `public` remote, with the leak audit as a hard gate.
#
# SAFETY: this runs ENTIRELY in a throwaway git worktree under a temp dir. It
# NEVER checks out, stages, or mutates your primary working directory — so a
# running `next dev` server is never disturbed. The worktree is a fresh checkout
# of the committed SOURCE_BRANCH (no node_modules / data / .env — none of that is
# tracked), and it is removed on exit.
#
# DRY RUN by default — builds + audits but does not push. Pass --push to publish.
#
#   ./scripts/publish-public.sh                 # build + audit only (no push)
#   ./scripts/publish-public.sh --push          # build + audit + force-push to public
#
# Env:
#   SOURCE_BRANCH   committed branch the public build is squashed from (default: main)
#   PUBLIC_REMOTE   remote to push to (default: public)
#
# Publishes the COMMITTED state of SOURCE_BRANCH (uncommitted changes are not
# included). The audit (scripts/audit-public.mjs) MUST pass or nothing is pushed;
# it derives its denylist live from the primary repo's data/budgeting.db.

set -euo pipefail

SOURCE_BRANCH="${SOURCE_BRANCH:-main}"
PUBLIC_REMOTE="${PUBLIC_REMOTE:-public}"
ORPHAN_BRANCH="public-main"
DO_PUSH=0
[[ "${1:-}" == "--push" ]] && DO_PUSH=1

RED=$'\e[31m'; GRN=$'\e[32m'; YEL=$'\e[33m'; RST=$'\e[0m'
die() { echo "${RED}✖ $1${RST}" >&2; exit 1; }

REPO_ROOT="$(git rev-parse --show-toplevel)"
git -C "$REPO_ROOT" rev-parse --verify -q "$SOURCE_BRANCH" >/dev/null \
  || die "Source branch '$SOURCE_BRANCH' not found."

# Isolated worktree under a temp dir — primary checkout is never touched.
WORKTREE="$(mktemp -d "${TMPDIR:-/tmp}/publish-public.XXXXXX")"
cleanup() {
  git -C "$REPO_ROOT" worktree remove --force "$WORKTREE" 2>/dev/null || true
  rm -rf "$WORKTREE" 2>/dev/null || true
  git -C "$REPO_ROOT" branch -D "$ORPHAN_BRANCH" 2>/dev/null || true
  git -C "$REPO_ROOT" worktree prune 2>/dev/null || true
}
trap cleanup EXIT

# Clear any stale orphan branch/worktree from a previous run.
git -C "$REPO_ROOT" worktree prune 2>/dev/null || true
git -C "$REPO_ROOT" branch -D "$ORPHAN_BRANCH" 2>/dev/null || true

echo "Building public template from '${SOURCE_BRANCH}' in an isolated worktree …"
git -C "$REPO_ROOT" worktree add -q --detach "$WORKTREE" "$SOURCE_BRANCH"

# Build the single orphan commit inside the worktree (no ancestry → no private
# history can leak through git log).
git -C "$WORKTREE" checkout -q --orphan "$ORPHAN_BRANCH"
git -C "$WORKTREE" add -A
# Belt-and-suspenders: strip any private path that is tracked on SOURCE_BRANCH.
git -C "$WORKTREE" rm -r --cached --quiet --ignore-unmatch \
  scratch .claude AGENTS.md CLAUDE.md START_HERE.md MAINTAINING.md \
  .publish-denylist .publish-allowlist 2>/dev/null || true

# AUDIT the worktree's staged set (the exact bytes that would publish). Hard gate.
# Run the PRIMARY repo's auditor; point the DB-derived denylist at the real DB
# (the worktree has no data/ — it is gitignored and never checked out).
echo "Running leak audit …"
if ! BUDGETING_DB_PATH="${BUDGETING_DB_PATH:-$REPO_ROOT/data/budgeting.db}" \
      node "$REPO_ROOT/scripts/audit-public.mjs" "$WORKTREE"; then
  die "Audit failed — NOT committing or pushing. Resolve violations above."
fi

git -C "$WORKTREE" commit -q -m "Release: public template update"
echo "${GRN}✓ Orphan commit built and audit passed.${RST}"

if [[ "$DO_PUSH" -eq 0 ]]; then
  echo "${YEL}DRY RUN — not pushing. Re-run with --push to publish to '${PUBLIC_REMOTE}'.${RST}"
  echo "Built commit: $(git -C "$WORKTREE" rev-parse --short HEAD)"
  exit 0
fi

echo "Force-pushing → ${PUBLIC_REMOTE}/main …"
git -C "$WORKTREE" push "$PUBLIC_REMOTE" "HEAD:main" --force
echo "${GRN}✓ Published to ${PUBLIC_REMOTE}.${RST}"
