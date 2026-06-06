# Next Session Prompt — full daemon live pipeline smoke

아래 프롬프트를 새 Codex 세션 첫 메시지로 그대로 붙여 넣는다.

```text
CLAUDE.md와 docs/handoff.md를 읽고, 최신 origin/develop 상태에서 다음 작업을 시작해줘.

작업 시작 순서:
1. git fetch origin --prune --tags
2. git switch develop
3. git pull --ff-only
4. develop에서 새 topic branch 생성: chore/full-daemon-live-smoke

먼저 아래 문서를 순서대로 읽고 현재 계약을 확인해줘:
1. CLAUDE.md
2. docs/handoff.md
3. docs/runbooks/two-job-smoke.md
4. docs/w5-operational-readiness.md
5. docs/repo-structure.md
6. docs/engineering-standards.md
7. docs/adr/002-worker-engines.md
8. docs/adr/004-headless-mcp-inheritance.md
9. docs/adr/009-w5-dashboard-stack-and-deployment.md

현재 상태:
- W5 Docker HTTP/API/static smoke는 로컬 Docker Desktop에서 통과했다.
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
- Docker worker readiness는 blocked다.
  - mount contract와 global cap은 pass
  - image 안에 `claude`/`codex` CLI 없음
  - Claude/Codex auth signal이 컨테이너에 mount되지 않음
- production `src/server.ts`는 아직 `runDaemonOnce`와 real worker engines/provisioner/prompts/gates를 wiring하지 않는다. 따라서 다음 핵심 리스크는 full daemon live pipeline smoke다.

이번 세션 목표:
- full daemon pipeline을 호스트에서 먼저 2개 job만 global cap 2~3으로 live smoke할 수 있는 최소 wiring을 설계/구현한다.
- 바로 full daemon live smoke가 위험하거나 과하면, 그 이유를 deterministic evidence로 남기고 최소 다음 작업을 문서화한다.
- Docker worker CLI/auth 설치는 별도 경로로 남기되, full daemon host smoke를 먼저 할지 Docker worker readiness를 먼저 풀지 판단 근거를 남긴다.

TDD/계약 우선 작업:
- 새 DB table은 추가하지 않는다.
- public auth는 추가하지 않는다.
- src/core, src/pipeline, src/scheduler에는 I/O import를 추가하지 않는다.
- CLI/API/dashboard 판단에 LLM output text를 사용하지 않는다.
- gate 판정은 exit code, 파일 아티팩트, checksum, structured JSON 같은 deterministic evidence만 사용한다.
- full daemon smoke 전에 테스트 가능한 wiring 계약을 먼저 추가한다.

가능한 구현 범위:
- host-only daemon smoke entrypoint 또는 script를 추가해 `runDaemonOnce`를 실제 `ClaudeCodeEngine`/`CodexEngine`, worktree provisioner, stage config, minimal prompts, deterministic gates와 연결한다.
- 2개 job만 enqueue/claim/run하고, worktree collision/provider cap/gate evidence를 `/tmp` evidence로 남긴다.
- server production loop까지 붙이는 변경은 작게 나눌 수 있으면 별도 후속으로 남긴다.
- Dockerfile에 worker CLI 설치를 바로 넣기보다, Docker worker readiness blocker와 필요한 auth volume/API-key mode를 문서화한다.

이번 세션에서 하지 말 것:
- dashboard analytics/charts/filter 확장
- public auth/OIDC/token auth 구현
- GitHub Issue/Jira write-back
- provider backoff 정교화
- multi-container split
- 3~5 job soak/nightly run
- 새 DB table 추가
- 비밀값 커밋

성공 기준:
1. full daemon live smoke wiring 계약이 테스트 또는 lint 가능한 구조로 고정된다.
2. 가능하면 host에서 정확히 2개 job만 global cap 2 또는 3으로 실행한다.
3. live daemon smoke를 실행했다면:
   - job 2개만 실행
   - worktree path 충돌 없음
   - provider cap 초과 없음
   - gate evidence가 deterministic 구조로 기록됨
4. live daemon smoke를 실행하지 못했다면:
   - 불가능한 이유가 구체적으로 기록됨
   - 다음에 필요한 최소 작업이 docs/handoff.md와 docs/runbooks/two-job-smoke.md에 남음
5. `pnpm format:check` 통과
6. 관련 targeted tests 통과
7. 가능한 경우 `pnpm verify` 통과

검증 후:
- 변경이 있으면 English commit message로 커밋한다.
- PR을 만들 경우 develop 대상으로 생성한다.
- CI가 있으면 all pass를 확인한다.
- merge까지 요청받은 경우에만 squash merge한다.
```

## Why This Is Next

Host에서 실제 Claude/Codex worker probe는 통과했다. 남은 가장 큰 리스크는 이 worker들을 pando daemon의 실제 queue/worktree/stage/gate wiring에 연결했을 때도 2개 job을 안전하게 처리하는가다. 그 다음에 Docker worker CLI/auth hardening이나 W6 soak로 넘어가는 게 맞다.
