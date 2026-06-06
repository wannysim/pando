# ADR-006: `~/.ai-skills` 결합은 설정·계약·버전핀으로 격리한다 (anti-corruption layer)

- 상태: 승인 (2026-06-06)
- 근거: 아키텍처 평가 (docs/handoff.md)

## 맥락

pando는 분리된 레포 `~/.ai-skills`의 스킬을 재사용한다 (implement-jira, jira-context-gatherer, worktree-dispatch 규약, verifier 등). 복제하지 않는 건 이중관리 회피(repo-structure §1)로 옳다. 그러나 평가 결과 결합이 **의식·문서화됐을 뿐 코드 격리가 없다**:

- 스킬 이름이 스크립트/코드에 문자열로 하드코딩됨(`/implement-jira`). 리네임/삭제 시 즉사.
- PLAN.md 구조는 implement-jira가 정의하는데 pando 게이트가 이를 파싱(`[Blocker]` / 분해 단위). **암묵 계약 drift가 런타임까지 안 잡힌다.** `artifacts.ts`는 미구현, 계약 테스트 0건.
- 같은 사람이 양쪽을 관리하므로, 본인이 ai-skills를 독립적으로 발전시키다 pando를 조용히 깨뜨리는 시나리오가 열려 있다.

## 결정

1. **스킬 이름을 설정으로 추출** — stage→skill 매핑을 `stages.yaml`/profile에 둔다(`plan.skill: implement-jira`처럼). 코드는 문자열을 직접 참조하지 않는다. (`conventions`가 이미 이 방식)
2. **아티팩트 계약을 pando가 소유** — `src/core/artifacts.ts`가 `_spec.md`/`PLAN.md`의 필수 스키마를 정의·검증한다. ai-skills 출력의 **골든 파일 계약 테스트**를 둔다(W1의 AP-1234 PLAN.md를 픽스처로). drift 시 CI가 잡는다 — engine contract test 철학(engineering-standards §2.2)을 스킬 계약에도 적용.
3. **의존 규약 버전핀** — pando가 의존하는 ai-skills 규약 목록을 명시·유지한다: worktree-dispatch §1(경로)/§5(락)/§8(cleanup), implement-jira batch PLAN.md 스키마, verifier 구조화 JSON. 변경 시 양쪽 동기화 PR을 짝짓는다.

## 결과

- ai-skills 스킬 구조 변경이 pando를 "조용히" 깨는 경로가 막힌다 — 최악도 계약 테스트 적색으로 표면화.
- stacked PR 정책 완화(ADR-007)가 이 결합 축소의 첫 적용 사례 — PLAN.md 구조가 양쪽에서 동시에 바뀌므로 계약 픽스처도 함께 갱신.
- W2에서 `artifacts.ts` + 계약 테스트를 TDD로 구현. 의존 규약 목록은 handoff에 유지.
