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
- `npm i -g pandoctl`은 임시 `--prefix`로 검증됐다(better-sqlite3 prebuilt 해결, node-gyp 불필요). 실제 npm publish는 아직 안 했다.
- Host worker readiness, host live worker 2-job probe, host full-daemon live dogfood는 완료됐다.
- Docker live worker smoke는 시도 완료. post-CA rerun에서 Codex exit 0, Claude는 managed connector 비상속으로 auth blocker가 남아 있다.

W6 후보(하나를 골라 작게 진행):
- Docker live worker smoke를 `ANTHROPIC_API_KEY` 또는 container-local `claude /login` credential로 재실행.
- `pandoctl@0.1.0` 실제 npm publish (dry-run → publish, provenance/2FA 확인).
- 3~5 job soak/nightly run + failure analytics.
- notifications / provider backoff 정교화.

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

설치/배포 경로(`pandoctl` 번들 + `npm i -g pandoctl` 검증)까지 닫혔다. 다음 병목은 실제 운영 신뢰성이다: Docker live worker credential, 실제 npm publish, soak/nightly, 실패 분석. 모두 deterministic evidence와 작은 PR 단위로 진행한다.
