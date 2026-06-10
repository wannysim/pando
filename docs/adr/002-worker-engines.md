# ADR-002: 워커는 기존 코딩 에이전트 CLI를 헤드리스로 부린다 (직접 구축 안 함)

- 상태: 승인 (2026-06-06)

## 맥락

에이전트 루프(파일 탐색/편집/셸/컨텍스트 관리)를 LangGraph 등으로 직접 만들지, 기존 CLI를 워커로 쓸지. docs/research-v1.md §2 비교 참조.

## 결정

- 워커 = **Codex CLI(`codex exec --ephemeral --json`)와 Claude Code(`claude -p`)**, `WorkerEngine` 인터페이스로 추상화
- 단계별 엔진/모델 매핑은 `config/stages.yaml` — SPEC/PLAN은 Claude Code(MCP + `.ai-skills` 스킬 의존), TEST/IMPL은 Codex
- REVIEW는 구현 단계와 **다른 모델** 강제 (reward hacking 방어)

## 이유

- 에이전트 루프 재발명 비용이 막대하고, 우리의 차별점은 오케스트레이션(게이트/스케줄링/Jira)이지 루프가 아니다
- Codex는 `model_providers` config로 서드파티 모델도 지원 (1차 소스 검증됨) — "OpenAI 기본 + 교체 가능" 충족
- 기존 `.ai-skills` 스킬(implement-jira batch mode)이 Claude Code 전제라 SPEC/PLAN 재사용에 유리

## 결과

- 게이트는 워커 출력 텍스트를 신뢰하지 않는다 — `WorkerResult.output`은 Gate 컨텍스트에서 타입 수준 제외 (Hyrum's Law)
- 엔진 추가는 contract test 스위트 통과가 조건
