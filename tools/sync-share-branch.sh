#!/bin/bash
# Rebuilds the `share` branch from the current HEAD, stripping the paths
# marked export-ignore in .gitattributes (CLAUDE.md, TODO.md, GATES.md,
# MARTIN_NOTES.md, memory/), commits, and pushes it to origin.
#
# Uses a throwaway git worktree so there's no second clone to maintain by hand.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

BRANCH=share
WORKTREE_DIR=".worktree-share"
ARCHIVE=$(mktemp -t share-archive).tar

git archive --format=tar --worktree-attributes -o "$ARCHIVE" HEAD

git worktree remove --force "$WORKTREE_DIR" 2>/dev/null || true
if git show-ref --verify --quiet "refs/remotes/origin/$BRANCH"; then
  git worktree add "$WORKTREE_DIR" "origin/$BRANCH"
  (cd "$WORKTREE_DIR" && git checkout -B "$BRANCH")
else
  git worktree add --detach "$WORKTREE_DIR"
  (cd "$WORKTREE_DIR" && git checkout --orphan "$BRANCH" && git rm -rf --quiet .)
fi

find "$WORKTREE_DIR" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
tar -xf "$ARCHIVE" -C "$WORKTREE_DIR"
rm -f "$ARCHIVE"

cd "$WORKTREE_DIR"
git add -A
if git diff --cached --quiet; then
  echo "share branch already up to date, nothing to commit"
else
  git commit -m "Sync share branch from main ($(git -C .. rev-parse --short HEAD))"
  git push origin "$BRANCH"
fi
cd ..
git worktree remove --force "$WORKTREE_DIR"
