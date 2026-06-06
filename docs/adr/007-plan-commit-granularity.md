# ADR-007: PLAN 산출은 작업단위 커밋 분할이 기본, Stacked PR은 대규모일 때만 제안

- 상태: 승인 (2026-06-06)
- 근거: 사용자 운영 피드백 + design-v2 §7 설계 긴장

## 맥락

`implement-jira`(+`stacked-pr-planning`)가 PLAN을 항상 **Stacked PR** 전제로 산출해, 작은 티켓도 불필요하게 PR을 쪼개는 경향이 생겼다. design-v2 §7도 이미 지적했다: 자동 파이프라인에서 stacked는 PR 간 의존(PR1 머지 전 PR2?) 문제를 낳으니 1차는 티켓당 PR 1개로 단순화하고 PR 분해는 커밋 단위로 강등하라. 자동 파이프라인의 1차 목표는 단일 PR을 깔끔한 커밋 열로 만드는 것이지 PR 스택 관리가 아니다.

## 결정

1. **기본 산출물 = 단일 PR + 작업단위 커밋 분할.** PLAN.md의 로드맵 섹션은 PR이 아니라 **커밋 단위**로 분해한다.
2. **Stacked PR은 예상 net 변경량 1000줄 초과로 판단될 때만 *제안*한다** (강제 아님). 그 경우에만 `stacked-pr-planning`을 로드.
3. **양쪽 동시 반영** (ADR-006 결합 축소 원칙) — `~/.ai-skills/skills/implement-jira/SKILL.md`(스킬 동작)와 pando 문서/게이트(design-v2 §4·§7, PLAN 게이트의 "분해 단위 검사")를 함께 갱신.

## 결과

- pando의 PLAN 게이트는 "PR 분해" 대신 **커밋 분해 단위**를 검사한다. Stacked 제안 섹션은 옵션(1000줄+).
- ai-skills `implement-jira`는 1000줄 이하에서 `stacked-pr-planning`을 로드하지 않는다 (2026-06-06 반영 완료).
- Stacked PR 자동화는 리뷰 사이클까지 자동화된 후(W5+)의 과제로 유지.
