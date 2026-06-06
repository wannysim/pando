# Next Session Prompt — pandoctl npm distribution

아래 프롬프트를 새 Codex/Claude 세션 첫 메시지로 그대로 붙여 넣는다.

```text
CLAUDE.md, docs/handoff.md, docs/practical-adoption-roadmap.md, docs/runbooks/two-job-smoke.md를 읽고 최신 origin/develop 상태에서 PR 10을 시작해줘.

작업 시작 순서:
1. git fetch origin --prune --tags
2. git switch develop
3. git pull --ff-only
4. develop에서 새 topic branch 생성

먼저 아래 문서를 순서대로 읽고 현재 계약을 확인해줘:
1. CLAUDE.md
2. docs/handoff.md
3. docs/practical-adoption-roadmap.md
4. docs/runbooks/local-pando-runner.md
5. docs/runbooks/agentctl.md
6. docs/runbooks/two-job-smoke.md
7. docs/repo-structure.md
8. docs/engineering-standards.md

현재 상태:
- Host worker readiness, host live worker 2-job probe, host full-daemon live dogfood는 완료됐다.
- `pando start` one-command local run은 PR #41로 develop에 들어왔다.
- Dashboard/API inline natural-language brief intake는 PR #54로 develop에 들어왔다.
- Dashboard/CLI follow-up, draft PR gate, pandoctl bin rename/docs parity는 PR #40~#44/#51로 들어왔다.
- Real git checksum/diff adapter는 PR #52, release/* base-branch routing은 PR #53으로 들어왔다.
- Docker worker readiness는 PR #55와 follow-up으로 정리됐다.
  - opt-in Linux worker CLI install layer가 있다.
  - runtime image에는 CA bundle, git, openssh-client가 있다.
  - readiness evidence는 worker CLI, Claude config file, Codex writable config dir, auth signal, mount, git credential presence를 secret 없이 기록한다.
  - Docker live worker smoke는 실제 시도했고 post-CA rerun에서 Codex는 exit `0`까지 확인했다.
  - 이 환경에서 Claude Code managed connector는 container로 상속되지 않는다. 실제 Docker Claude call은 `ANTHROPIC_API_KEY` 또는 container-local `claude /login` credential이 필요하다.
- 남은 roadmap 항목은 pandoctl npm distribution(PR 10) 하나다.

다음 세션 목표는 PR 10: pandoctl npm distribution.

PR 10 구현 목표:
- published binary는 `pandoctl` 하나로 정리한다.
- `pandoctl start`는 현재 `pando start`와 같은 local daemon/dashboard bootstrap을 제공한다.
- `pandoctl submit/list/show/retry/cancel/cleanup/watch/smoke`는 현재 operations CLI 기능을 제공한다.
- 배포 패키지는 tsx 직접 실행이 아니라 빌드/번들된 JS + shebang bin을 담는다.
- `packages/pandoctl/package.json`의 placeholder `0.0.1`/stub을 실제 publish 후보로 교체한다.
- `better-sqlite3` native dependency 글로벌 설치 전략을 검증하거나, 실패 시 구조화된 이유와 다음 결정을 문서화한다.

TDD/계약 우선 작업:
- 실패하는 bin/package test를 먼저 작성한다.
- 새 DB table은 추가하지 않는다.
- public auth는 추가하지 않는다.
- src/core, src/pipeline, src/scheduler에는 I/O import를 추가하지 않는다.
- CLI/API/dashboard 판단에 LLM output text를 사용하지 않는다.
- gate 판정은 exit code, 파일 아티팩트, checksum, structured JSON 같은 deterministic evidence만 사용한다.
- 비밀값을 출력하거나 커밋하지 않는다.
- evidence 파일은 커밋하지 않는다.

이번 세션에서 하지 말 것:
- public auth/OIDC/token auth 구현
- GitHub Issue/Jira write-back
- provider backoff 정교화
- multi-container split
- 3~5 job soak/nightly run
- full-screen TUI
- 새 DB table 추가
- 비밀값 커밋

성공 기준:
1. PR 10 범위에 맞는 작은 변경 단위로 진행한다.
2. 필요한 테스트 또는 문서 검증이 실행된다.
3. `pnpm format:check` 통과
4. 가능한 경우 `pnpm verify` 통과
5. 실패가 있으면 실패 사유와 로그 요약을 `/tmp` 아래 structured JSON evidence로 남긴다.

검증 후:
- 변경이 있으면 English commit message로 커밋한다.
- PR을 만들 경우 develop 대상으로 Draft PR을 생성한다.
- CI가 있으면 all pass를 확인한다.
- merge까지 요청받은 경우에만 squash merge한다.
```

## Why This Is Next

자가개발을 반복하기 위한 local start, inline brief intake, dashboard/CLI operations follow-up, deterministic gates, release branch routing, Docker readiness hardening은 develop에 들어왔다. 다음 병목은 설치 경로다. 사용자가 repo clone 없이 `npm i -g pandoctl` 또는 `npx pandoctl`로 시작하고 운영 CLI를 쓸 수 있어야 한다.
