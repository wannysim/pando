# Next Session Prompt — W6 operational expansion

Stacked PR Roadmap의 PR 1~10이 모두 닫혔다(최신 항목: PR 10 pandoctl npm distribution). 다음은 W6 운영 확장이다. 아래 프롬프트를 새 Codex/Claude 세션 첫 메시지로 그대로 붙여 넣는다.

```text
CLAUDE.md, docs/handoff.md, docs/practical-adoption-roadmap.md, docs/runbooks/local-pando-runner.md, docs/runbooks/agentctl.md를 읽고 최신 origin/develop 상태에서 W6 운영 확장을 시작해줘.

작업 시작 순서:
1. git fetch origin --prune --tags
2. git switch develop
3. git pull --ff-only
4. develop에서 새 topic branch 생성

현재 상태:
- Stacked PR Roadmap PR 1~10은 모두 develop에 들어왔다.
- 통합 `pandoctl` 바이너리(`pandoctl start` + ops 서브커맨드)가 있고, `packages/pandoctl`는 esbuild로 번들된 실제 publish 후보 `pandoctl@0.1.0`이다.
- `pandoctl` release workflow가 있다. `npm i -g pandoctl`은 임시 `--prefix`로 검증됐지만 실제 npm publish는 아직 하지 않는다.
- Host worker readiness, host live worker 2-job probe, host full-daemon live dogfood는 완료됐다.
- Docker live worker smoke는 시도 완료. post-CA rerun에서 Codex exit 0, Claude는 managed connector 비상속으로 auth blocker가 남아 있다.
- PR #62로 `pnpm pando start`가 source checkout의 `dashboard/dist`를 기본 dashboard root로 쓰고, accidental local DB/evidence artifact는 repo root가 아니라 `/tmp`로 가게 됐다.

W6 실행 순서:
1. Docs/current-state sync: handoff/roadmap/prompt가 최신 merge 상태와 다음 순서를 같은 말로 설명하게 유지한다.
2. 3~5 job soak/nightly 운영화: 반복 실행 가능한 soak/nightly 루틴과 `/tmp` structured JSON summary를 만든다.
3. Dashboard failure/readiness analytics: soak/nightly 결과, terminal failure reason, readiness/auth blocker를 dashboard에서 바로 읽게 한다.
4. Provider backoff/retry policy: timeout/rate-limit/auth/transient failure를 deterministic failure kind로 나누고 retry/backoff를 정교화한다.
5. Docker Claude live worker smoke: `ANTHROPIC_API_KEY` 또는 container-local `claude /login` credential로 Docker Claude blocker를 재검증한다.
6. `pandoctl@0.1.0` 실제 npm publish: release workflow dry-run → publish → global install/update smoke는 마지막에 수행한다.

다음 세션에서는 위 순서에서 아직 끝나지 않은 가장 앞 항목 하나만 골라 작게 진행한다. notifications, GitHub Issue/Jira write-back, auth hardening, Docker egress policy, split containers/TUI는 위 1~6 이후로 미룬다.

지켜야 할 규칙:
- 새 DB table 추가하지 말 것.
- public auth/OIDC/token auth 구현하지 말 것.
- src/core, src/pipeline, src/scheduler에는 I/O import 추가하지 말 것.
- CLI/API/dashboard 판단에 LLM output text 사용하지 말 것.
- gate 판정은 exit code, 파일 아티팩트, checksum, structured JSON 같은 deterministic evidence만 사용할 것.
- 비밀값 출력/커밋 금지, evidence 파일 커밋 금지.
- 커밋 메시지, PR title/body는 English.
- TDD 규칙 준수: 실패 테스트 먼저, 구현은 그 다음.

성공 기준:
1. 선택한 변경이 W6 범위에 맞는 작은 단위여야 한다.
2. `pnpm format:check` 통과.
3. 가능한 경우 `pnpm verify` 통과.
4. 실패가 있으면 실패 사유와 로그 요약을 `/tmp` 아래 structured JSON evidence로 남긴다.

검증 후:
- 변경이 있으면 English commit message로 커밋한다.
- PR을 만들 경우 develop 대상으로 생성한다.
- CI가 있으면 all pass를 확인한다.
- merge까지 요청받은 경우에만 merge한다.
```

## Why This Is Next

설치/배포 경로(`pandoctl` 번들 + release workflow + `npm i -g pandoctl` 검증)까지 대부분 닫혔지만, 실제 publish는 마지막 순서다. 먼저 운영 신뢰성을 쌓는다: docs sync, soak/nightly 반복 실행, dashboard failure/readiness analytics, provider backoff를 닫은 뒤 Docker Claude credential smoke와 npm publish를 진행한다. 모두 deterministic evidence와 작은 PR 단위로 진행한다.
