#!/usr/bin/env bash
# W1 검증 ④: 게이트 — exit code + 테스트 파일 체크섬 불변 (docs/research-v1.md §3.2)
set -euo pipefail

WT_PATH="${1:?usage: 04-gates.sh <worktree-path> [checksum-file]}"
CHECKSUM_FILE="${2:-/tmp/pando-test-checksums.txt}"

cd "$WT_PATH"

# ① 테스트 파일 체크섬 (TEST 단계 직후 저장해둔 것과 비교)
if [ -f "$CHECKSUM_FILE" ]; then
  if sha256sum -c "$CHECKSUM_FILE" --quiet; then
    echo "GATE PASS: test files unchanged"
  else
    echo "GATE FAIL: test files were modified during IMPL" >&2
    exit 1
  fi
else
  # 최초 실행: 체크섬 기록
  find . -path ./node_modules -prune -o \( -name "*.test.ts" -o -name "*.test.tsx" -o -name "*.spec.ts" \) -print0 \
    | xargs -0 sha256sum > "$CHECKSUM_FILE"
  echo "checksums recorded: $CHECKSUM_FILE"
fi

run_package_action() {
  local action="$1"
  local manager

  if [ -f yarn.lock ]; then
    manager="yarn"
  elif [ -f pnpm-lock.yaml ]; then
    manager="pnpm"
  elif [ -f package-lock.json ]; then
    manager="npm"
  else
    echo "no lockfile detected; cannot run $action gate" >&2
    exit 1
  fi

  case "$action:$manager" in
    typecheck:npm) npx tsc --noEmit ;;
    typecheck:yarn) yarn tsc --noEmit ;;
    typecheck:pnpm) pnpm exec tsc --noEmit ;;
    test:npm) npm run test ;;
    lint:npm) npm run lint ;;
    *) "$manager" "$action" ;;
  esac
}

# ② 결정적 게이트: exit code만 신뢰
run_package_action test
run_package_action lint
run_package_action typecheck
echo "GATE PASS: test+lint+types"
