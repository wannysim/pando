#!/usr/bin/env bash
# W1 검증 ③: PLAN.md를 주고 Codex 헤드리스로 구현 1회 (docs/research-v1.md §2)
set -euo pipefail

WT_PATH="${1:?usage: 03-impl-codex.sh <worktree-path>}"

cd "$WT_PATH"
test -f PLAN.md || { echo "PLAN.md not found" >&2; exit 1; }

codex exec --ephemeral --cd "$WT_PATH" --config 'approval_policy="never"' --json --sandbox workspace-write \
  -o /tmp/pando-impl-result.txt \
  "PLAN.md를 읽고 PR 1(pts·a-components jest config 표준화)에 해당하는 변경만 구현해. 이 레포는 yarn@1 모노레포다 (pnpm 아님). 테스트 파일(*.test.*, *.spec.*)은 수정하지 마. PR 1은 순수 config 리팩터이므로 기존 테스트의 동작을 바꾸지 않아야 한다. 게이트(test/lint/types)는 오케스트레이터가 04-gates로 별도 판정하므로 여기서는 구현에 집중한다."
