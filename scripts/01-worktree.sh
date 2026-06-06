#!/usr/bin/env bash
# W1 검증 ①: 데몬 방식 worktree 생성 — 원본 repo의 working tree를 건드리지 않는다
# (docs/design-v2-multi-repo.md §3.2 / .ai-skills worktree-dispatch §1 경로 규약 호환)
set -euo pipefail

REPO_PATH="${1:?usage: 01-worktree.sh <repo-path> <ticket-id> [base-branch]}"
TICKET="${2:?ticket id required}"
BASE="${3:-develop}"

REPO_NAME="$(basename "$REPO_PATH")"
BRANCH="feat/${TICKET}"
SLUG="${BRANCH//\//-}"
WT_ROOT="${WORKTREE_ROOT:-$HOME/.worktrees}"
WT_PATH="$WT_ROOT/$REPO_NAME/$SLUG"

LOCK="$REPO_PATH/.git/.dispatch.lock"   # worktree-dispatch §5 규약 공유
exec 9>"$LOCK"
flock -w 30 9 || { echo "lock timeout: $LOCK" >&2; exit 1; }

git -C "$REPO_PATH" fetch origin "$BASE"

if [ -d "$WT_PATH" ]; then
  echo "worktree exists, reusing: $WT_PATH"
else
  git -C "$REPO_PATH" worktree add "$WT_PATH" -b "$BRANCH" "origin/$BASE"
fi

# setup 훅 (프로파일의 setup/env_files에 해당 — W1은 lockfile로 PM 감지)
if [ -f "$REPO_PATH/.env.local" ]; then cp "$REPO_PATH/.env.local" "$WT_PATH/"; fi
( cd "$WT_PATH"
  if   [ -f yarn.lock ];         then yarn install
  elif [ -f pnpm-lock.yaml ];    then pnpm install
  elif [ -f package-lock.json ]; then npm install
  else echo "no lockfile detected; skipping install"; fi )

echo "---"
echo "worktree: $WT_PATH"
echo "branch:   $BRANCH (from origin/$BASE)"
