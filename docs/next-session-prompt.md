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
- PR #33~#35로 기본 self-dogfood 운영 profile을 all-Claude로 전환하고, local runtime artifact prompt와 TEST/IMPL edit-stage toolset을 보강했다.
- PR #36~#38로 pando가 concurrency 3 batch에서 README/getting-started, dashboard operations context, agentctl operations status 작업을 끝까지 수행했다. Evidence: `/tmp/pando-multi-run-20260607-024505/pando-multi-success-evidence.json`.
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
- local daemon loop는 `PANDO_DAEMON_ENABLED=1`로 켤 수 있다. 다만 현재 실행 경로는 env var가 많고, 웹 submit도 brief file path 중심이라 실제 사용자 UX와 거리가 있다.

이번 세션 목표:
- full daemon live smoke를 다시 목표로 삼지 않는다. PR #36~#38 이후에는 self-dogfood를 사람이 반복해서 쓰기 쉽게 만드는 것이 목표다.
- 우선순위는 one-command local run, web inline brief intake, README/README.ko/docs parity, dashboard/agentctl follow-up, Docker worker readiness 순서다.
- 작업이 작고 안전하면 pando self-dogfood 흐름으로 실행할 수 있는지 확인하되, pando 실행 자체가 과하게 복잡하면 먼저 UX 개선 작업을 직접 고친다.
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
- one-command local run: 긴 env var 블록 없이 `pando start` 또는 `pnpm pando start`로 daemon/dashboard/local DB/worktree를 띄우는 흐름.
- web inline brief intake: dashboard에서 자연어 작업 설명과 spec/docs/assets reference를 입력하면 pando가 canonical brief를 만들고 queue에 넣는 흐름.
- README/README.ko/docs parity: README.md, README.ko.md, runbook, handoff가 같은 current status와 limitations를 설명하도록 맞춤.
- dashboard follow-up: branch display를 `job.branch` 우선으로 수정하고 duration/cost/evidence truncation/copy를 마저 구현.
- terminal follow-up: `agentctl watch`, smoke/readiness command, API-backed vs DB-backed mode 문서화.
- Docker worker readiness: CLI/auth/git credentials blocker를 구조화 evidence와 문서로 좁힌다.

이번 세션에서 하지 말 것:
- full daemon live smoke 자체를 다시 주요 목표로 삼기
- dashboard analytics/charts/filter 대규모 확장
- public auth/OIDC/token auth 구현
- GitHub Issue/Jira write-back
- provider backoff 정교화
- multi-container split
- 3~5 job soak/nightly run
- full-screen TUI
- public auth
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

Host full-daemon contract/live smoke와 3-job pando self-dogfood batch는 이미 develop에 들어왔다. 다음 리스크는 "돌릴 수 있느냐"가 아니라 "사람이 웹/CLI에서 자연스럽게 다시 돌릴 수 있느냐"다. 특히 local start command와 inline brief intake가 없으면 자가개발은 계속 운영자 수동 절차에 묶인다.
