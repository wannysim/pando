# Next Session Prompt — live worker smoke readiness

아래 프롬프트를 새 Codex 세션 첫 메시지로 그대로 붙여 넣는다.

```text
CLAUDE.md와 docs/handoff.md를 읽고, 최신 origin/develop 상태에서 다음 작업을 시작해줘.

작업 시작 순서:
1. git fetch origin --prune --tags
2. git switch develop
3. git pull --ff-only
4. develop에서 새 topic branch 생성: chore/live-worker-smoke-readiness

먼저 아래 문서를 순서대로 읽고 현재 계약을 확인해줘:
1. CLAUDE.md
2. docs/handoff.md
3. docs/w5-operational-readiness.md
4. docs/runbooks/two-job-smoke.md
5. docs/repo-structure.md
6. docs/engineering-standards.md
7. docs/adr/002-worker-engines.md
8. docs/adr/004-headless-mcp-inheritance.md
9. docs/adr/009-w5-dashboard-stack-and-deployment.md

현재 상태:
- W5는 PR #25까지 develop에 반영되어 완료됐다.
- Docker HTTP/API/static dashboard smoke는 로컬 Docker Desktop에서 성공했다.
  - `docker compose -f deploy/docker-compose.yml up --build -d`
  - container health `healthy`
  - `/health` JSON 200
  - `/dashboard` HTML 200
  - dashboard JS asset 200
  - `/briefs` enqueue + `/jobs` list 200
  - 테스트 후 `docker compose -f deploy/docker-compose.yml down -v`로 정리 완료
- deterministic fake two-job smoke 계약과 runbook은 있다.
- 아직 남은 핵심 작업은 실제 Claude/Codex worker 2-job smoke readiness다.

이번 세션 목표:
- 실제 Claude/Codex worker 2-job smoke를 바로 실행할 수 있는지 환경을 점검한다.
- 바로 실행 가능하면 global concurrency 2 또는 3으로 제한해서 2개 job만 live smoke한다.
- 바로 실행 불가능하면, 왜 불가능한지 deterministic evidence로 기록하고 다음에 필요한 최소 구현/설정만 문서화한다.
- Docker 안에서 worker를 돌릴지, 로컬 호스트 daemon에서 먼저 live smoke할지 판단 근거를 남긴다.

먼저 해야 할 환경 점검:
1. `pnpm --version`이 package.json의 packageManager와 맞는지 확인한다.
2. `pnpm verify`가 시작 전 baseline으로 통과하는지 확인한다. 시간이 너무 오래 걸리면 적어도 targeted tests + `pnpm format:check`를 먼저 실행하고 이유를 기록한다.
3. Docker daemon 상태와 compose smoke를 다시 확인한다.
   - `docker compose -f deploy/docker-compose.yml config`
   - 가능하면 `docker compose -f deploy/docker-compose.yml up --build -d`
   - `/health`, `/dashboard`, `/briefs`, `/jobs` 확인 후 `down -v`
4. 호스트와 컨테이너 각각에서 worker readiness를 확인한다.
   - host: `claude --version`, `codex --version`
   - container: `docker run --rm deploy-pando:latest sh -lc 'command -v claude; command -v codex; node --version; pnpm --version'`
   - API key/auth volume 후보: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME`
   - git credentials가 target repo clone/fetch/push에 충분한지 확인한다. secret 값은 출력하지 않는다.
5. config/mount contract를 점검한다.
   - SQLite: `/data/pando.sqlite`
   - repos: `/repos`
   - worktrees: `/worktrees`
   - config: `/config`
   - skills: `/skills`
   - global cap: 2 또는 3

TDD/계약 우선 작업:
- live smoke를 자동화하기 전에 smoke readiness를 테스트 가능한 구조로 고정한다.
- 새 DB table은 추가하지 않는다.
- public auth는 추가하지 않는다.
- src/core, src/pipeline, src/scheduler에는 I/O import를 추가하지 않는다.
- CLI/API/dashboard 판단에 LLM output text를 사용하지 않는다.
- gate 판정은 exit code, 파일 아티팩트, checksum, structured JSON 같은 deterministic evidence만 사용한다.

가능한 구현 범위:
- `scripts/two-job-smoke.mjs`를 확장해 `--mode readiness` 또는 `--mode live`에서 worker CLI/auth/mount readiness를 structured JSON evidence로 기록하게 한다.
- `smoke/two-job-smoke.contract.json`에 readiness checks를 추가한다.
- `docs/runbooks/two-job-smoke.md`에 host-mode vs docker-mode live worker smoke 절차를 분리한다.
- 필요하면 Dockerfile에 worker CLI 설치 준비 hook을 문서/옵션으로만 추가한다. 실제 secret이나 private auth material은 커밋하지 않는다.
- 실제 2-job live smoke가 가능하면 evidence 파일을 `/tmp` 같은 비커밋 경로에 남기고, docs에는 결과 요약만 남긴다.

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
1. readiness/live smoke 계약이 테스트 또는 lint 가능한 구조로 고정된다.
2. worker CLI/auth/mount 상태가 structured evidence로 기록된다.
3. live 2-job smoke를 실행했다면:
   - job 2개만 실행
   - global cap 2 또는 3
   - worktree path 충돌 없음
   - provider cap 초과 없음
   - gate evidence가 deterministic 구조로 기록됨
4. live smoke를 실행하지 못했다면:
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

W5의 HTTP/API/static 운영성은 검증됐다. 남은 가장 큰 리스크는 "worker가 실제로 컨테이너 또는 호스트 daemon에서 2개 job을 병렬로 처리하면서 worktree/provider/gate 계약을 지키는가"다. 이 리스크를 줄인 뒤에야 W6의 soak, auth hardening, notifications, write-back 같은 운영 확장으로 넘어가는 게 맞다.
