#!/usr/bin/env bash
# W1 검증 ②: Claude Code 헤드리스에서 /implement-jira --batch로 PLAN.md 생성
# ✅ 2026-06-06 AP-1234로 검증 완료 (docs/w1-runbook.md 실행 로그)
#
# ADR-004: MCP는 --mcp-config로 주입하지 않는다.
#   동일 URL이라도 주입하면 OAuth 미인증 "새 서버"가 생겨 인증을 깬다.
#   사용자의 claude.ai connector(managed)를 그대로 상속해야 한다.
#   → 이 머신에서 claude 대화형 로그인 1회 + Atlassian connector 연결이 전제조건.
set -euo pipefail

WT_PATH="${1:?usage: 02-plan-headless.sh <worktree-path> <ticket-id>}"
TICKET="${2:?ticket id required}"

cd "$WT_PATH"

# allowedTools 주의 (w1-runbook 결론 2·3):
# - Task: jira-context-gatherer 등 서브에이전트 호출에 필수
# - mcp__claude_ai_Atlassian: claude.ai connector 서버 단위 허용
# - Bash(git *)만으론 파이프/복합 명령이 거부돼 turn 낭비 — W2에서 화이트리스트 재설계
IMPLEMENT_JIRA_BATCH=1 claude -p "/implement-jira $TICKET --batch" \
  --output-format json \
  --allowedTools "Read,Glob,Grep,Write,Bash(git *),Task,mcp__claude_ai_Atlassian" \
  | tee "/tmp/pando-plan-$TICKET.json"

# 게이트: 결정적 신호만 — PLAN.md 존재 여부
test -f "$WT_PATH/PLAN.md" && echo "GATE PASS: PLAN.md exists" || { echo "GATE FAIL: no PLAN.md" >&2; exit 1; }
