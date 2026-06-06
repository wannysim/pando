# Next Session Prompt — pando self-dogfood follow-up

아래 프롬프트를 새 Codex 세션 첫 메시지로 그대로 붙여 넣는다.

```text
CLAUDE.md, docs/handoff.md, docs/practical-adoption-roadmap.md, docs/runbooks/two-job-smoke.md를 읽고 최신 origin/develop 상태에서 다음 작업을 시작해줘.

작업 시작 순서:
1. git fetch origin --prune --tags
2. git switch develop
3. git pull --ff-only
4. develop에서 새 topic branch 생성

먼저 아래 문서를 순서대로 읽고 현재 계약을 확인해줘:
1. CLAUDE.md
2. docs/handoff.md
3. docs/practical-adoption-roadmap.md
4. docs/runbooks/two-job-smoke.md
5. docs/w5-operational-readiness.md
6. docs/repo-structure.md
7. docs/engineering-standards.md

현재 상태:
- PR #28로 pando self-profile과 host full-daemon contract smoke가 develop에 반영됐다.
- PR #29로 host full-daemon live 2-job smoke와 단일 pando self-dogfood job이 develop에 반영됐다.
- Host worker readiness는 통과했다.
  - `claude 2.1.167 (Claude Code)`
  - `codex-cli 0.137.0`
  - 기본 auth dirs `~/.claude`, `~/.codex` 존재
  - config/repos/worktrees/skills paths ready
- Host live worker 2-job probe는 통과했다.
  - `PANDO_GLOBAL_CONCURRENCY=2`
  - evidence: `/tmp/pando-live-worker-smoke/live-worker-smoke.json`
  - `SMOKE-LIVE-CLAUDE` exit `0`, `timedOut=false`
  - `SMOKE-LIVE-CODEX` exit `0`, `timedOut=false`
  - worktree collision 없음, provider cap pass, deterministic gate evidence pass
- Host full-daemon live smoke는 같은 두 job/global 2로 완료됐다.
  - baseline contract evidence: `/tmp/pando-full-daemon-smoke-contract-20260607-003713/full-daemon-smoke.json`
  - initial live failure evidence: `/tmp/pando-full-daemon-smoke-live-20260607-003749/live-failure-evidence.json`
  - resume evidence: `/tmp/pando-full-daemon-smoke-live-20260607-003749/live-resume-evidence.json`
  - dogfood evidence: `/tmp/pando-full-daemon-dogfood-20260607-010122/dogfood-evidence.json`
- Docker worker readiness는 blocked다.
  - mount contract와 global cap은 pass
  - image 안에 `claude`/`codex` CLI 없음
  - Claude/Codex auth signal이 컨테이너에 mount되지 않음
- production `src/server.ts`는 아직 상시 daemon loop를 돌리지 않는다. 지금 server는 API/static dashboard entrypoint다.

이번 세션 목표:
- full daemon live smoke를 다시 목표로 삼지 않는다. PR #29 이후에는 작은 pando self-dogfood 작업을 선택해 끝까지 돌리는 것이 목표다.
- 우선순위는 docs consistency, dashboard operations UX, terminal UX, README/getting-started, Docker worker readiness 순서다.
- 작업이 작고 안전하면 brief 기반 pando self-dogfood 흐름으로 실행할 수 있는지 확인한다.
- self-dogfood를 실행한다면 정확한 job 수, worktree path, final status, deterministic gate evidence를 `/tmp` structured JSON으로 남긴다.
- self-dogfood 실행이 과하거나 불필요하면 그 이유를 docs/handoff.md 또는 최종 응답에 구체적으로 남긴다.

TDD/계약 우선 작업:
- 새 DB table은 추가하지 않는다.
- public auth는 추가하지 않는다.
- src/core, src/pipeline, src/scheduler에는 I/O import를 추가하지 않는다.
- CLI/API/dashboard 판단에 LLM output text를 사용하지 않는다.
- gate 판정은 exit code, 파일 아티팩트, checksum, structured JSON 같은 deterministic evidence만 사용한다.
- 비밀값을 출력하거나 커밋하지 않는다.
- evidence 파일은 커밋하지 않는다.

가능한 구현 범위:
- docs consistency: roadmap, handoff, next-session prompt, runbook의 PR #29 이후 상태 정리.
- dashboard operations UX: job list/detail에서 status, stage, attempts, latest reason/evidence, worktree path, cost/duration을 더 잘 보이게 하는 작은 개선.
- terminal UX: `agentctl show/list/smoke`의 operator 흐름을 작게 개선하고 tests로 고정.
- README/getting-started: 현재 smoke 종류와 limitations를 처음 보는 사용자 기준으로 정리.
- Docker worker readiness: CLI/auth/git credentials blocker를 구조화 evidence와 문서로 좁힌다.

이번 세션에서 하지 말 것:
- full daemon live smoke 자체를 다시 주요 목표로 삼기
- dashboard analytics/charts/filter 대규모 확장
- public auth/OIDC/token auth 구현
- GitHub Issue/Jira write-back
- provider backoff 정교화
- multi-container split
- 3~5 job soak/nightly run
- 새 DB table 추가
- 비밀값 커밋

성공 기준:
1. 선택한 작은 작업이 docs/practical-adoption-roadmap.md의 현재 우선순위와 맞다.
2. 변경 범위가 작고 리뷰하기 쉽다.
3. 필요한 테스트 또는 문서 검증이 실행된다.
4. `pnpm format:check` 통과
5. 가능한 경우 `pnpm verify` 통과
6. 실패가 있으면 실패 사유와 로그 요약을 `/tmp` 아래 structured JSON evidence로 남긴다.

검증 후:
- 변경이 있으면 English commit message로 커밋한다.
- PR을 만들 경우 develop 대상으로 Draft PR을 생성한다.
- CI가 있으면 all pass를 확인한다.
- merge까지 요청받은 경우에만 squash merge한다.
```

## Why This Is Next

Host full-daemon contract/live smoke와 단일 pando self-dogfood job은 이미 develop에 들어왔다. 다음 리스크는 같은 흐름을 작은 실제 작업에 반복 적용할 때 문서, dashboard, terminal, README, Docker readiness가 운영자가 이해할 수 있는 상태인지다.
