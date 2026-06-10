# Local pando runner

이 runbook은 로컬에서 pando API/dashboard를 띄운 뒤, 같은 SQLite queue를 local daemon loop가 처리하게 하는 최소 경로다.

> 빠른 경로는 아래 "Quick start (`pando start`)"다. 단일 명령으로 DB/worktree/config/dashboard/daemon을 함께 띄운다. 환경 변수를 직접 제어하고 싶거나 동작을 자세히 이해하고 싶으면 그 아래 "Start local pando (manual env path)"를 본다. 두 경로는 같은 기본값(`/tmp/pando-local-<timestamp>` run root, `config/`, port 3210, daemon enabled)을 쓴다.

## Quick start (`pando start`)

긴 env block 없이 로컬 pando를 한 번에 띄운다.

같은 pando server에서 dashboard까지 열려면 source checkout에서 dashboard를 한
번 build한다.

```bash
bun --filter=@pando/dashboard run build
```

```bash
bun run pando start
```

기본 동작:

- DB/worktree는 `/tmp/pando-local-<timestamp>` 아래에 생성된다 (run root와 `worktrees/` 디렉터리는 자동으로 만든다).
- config dir은 repo의 `config/`다.
- dashboard는 `http://127.0.0.1:3210/dashboard`다. Source checkout에서는
  `dashboard/dist`가 있으면 이 asset을 같은 server에서 서빙한다.
- daemon은 enabled, global concurrency 1이다.

시작 로그가 dashboard URL, API health URL, DB path, worktree root, stop 방법(Ctrl+C), cleanup 명령(`rm -rf /tmp/pando-local-<timestamp>`)을 출력한다. secret 값은 출력하지 않는다.

`dashboard/dist`가 없으면 API/daemon은 그대로 뜨지만 `/dashboard` asset은 없을
수 있다. 이 경우 위 build를 실행하거나, frontend 개발 중에는 별도 Vite dev
server를 띄운다.

```bash
VITE_PANDO_API_URL=http://127.0.0.1:3210 bun --filter=@pando/dashboard run dev
```

플래그로 기본값을 바꿀 수 있다.

```bash
bun run pando start --port 4000 --config-dir config --concurrency 3 --tick-ms 500
```

- `--concurrency`는 1~3만 허용한다.
- 요청한 port가 이미 사용 중이면 다음 빈 port를 자동으로 찾아 그 URL을 로그에 찍는다. 10개 안에 빈 port가 없으면 명확한 에러로 종료하니 `--port <n>`으로 다른 port를 고른다.

usage는 인자 없이, 또는 `help`/`--help`로 본다.

```bash
bun run pando help
```

### Published `pandoctl` (npm)

배포되는 운영 CLI는 `pandoctl` 하나로 통합돼 있다. local start와 job operation을 한 바이너리의 서브커맨드로 제공한다.

```bash
npm i -g pandoctl      # 또는: npx pandoctl <command>

pandoctl start         # 로컬 daemon/dashboard/API 부트스트랩 (= 이 repo의 `pando start`)
pandoctl list          # 운영 CLI (submit/list/show/retry/cancel/cleanup/watch/smoke)
pandoctl show <id>
pandoctl help
```

패키지는 자체 JS를 esbuild로 번들하고, native 모듈은 `better-sqlite3` 하나만 dependency로 두어 설치 시 prebuilt 바이너리로 해결한다. dashboard SPA 자산은 번들에 포함하지 않으므로, dashboard는 `PANDO_STATIC_DASHBOARD_ROOT`로 빌드된 dashboard root가 주어질 때만(Docker 이미지 또는 dashboard를 빌드한 repo 체크아웃) 서빙된다.

이미 설치한 global package는 새 publish 이후 아래 명령으로 갱신한다.

```bash
npm update -g pandoctl
```

체크아웃에서 배포본을 빌드/검증하려면:

```bash
bun run build:pandoctl        # packages/pandoctl/dist/pandoctl.mjs (+ schema.sql) 생성
bun run smoke:pandoctl-pack   # npm pack 내용·compiled bin·native sqlite 로드 검증, /tmp에 evidence
```

### Global `pando` / `pandoctl` from a checkout

repo 안에서 매번 `bun run pando` / `bun run pandoctl`을 치는 대신 전역 명령으로 만들 수도 있다. 이 repo의 `package.json` `bin`은 `pando`와 `pandoctl`을 모두 노출하며, `pandoctl`은 이제 `start`까지 포함한 통합 진입점(`src/cli/pandoctl.ts`)에 연결된다.

```bash
# repo 안에서 한 번 실행 (Bun 기반 dev shim)
bun link
# 또는
npm i -g .

# 이후 어디서든
pandoctl start         # 통합 진입점 (= pando start)
pando start            # 동일한 daemon 부트스트랩 (backward-compat)
pandoctl list
```

> 참고: bare 이름 `pando`는 이미 public npm registry에 점유돼 있다(ADR-010). 그래서 **배포되는 CLI 이름은 `pandoctl`**이다. 위 `bun link` / `npm i -g .`는 이 repo의 Bun 기반 dev shim을 링크하고, `npm i -g pandoctl`은 `packages/pandoctl`의 번들된 배포본을 설치한다. 내부 모듈 이름 `agentctl`은 ADR-010에 따라 당분간 유지한다.

## Start local pando (manual env path)

아래는 동작을 직접 제어하고 싶을 때 쓰는 자세한 개발자용 경로다.

## Preconditions

- `bun install` 완료
- `codex`, `gh`, `git` CLI 사용 가능
- `gh auth status` 통과
- OpenAI auth는 `OPENAI_API_KEY` 또는 저장된 Codex auth로 준비
- `claude`는 legacy/custom stage profile이 `claude-code`를 선택할 때만 optional로 필요
- evidence나 임시 DB는 repo 밖(`/tmp` 등)에 둔다

### Boot with env vars

```bash
export RUN_ID="$(date +%Y%m%d-%H%M%S)"
export ROOT="/tmp/pando-local-runner-$RUN_ID"
mkdir -p "$ROOT/worktrees"

PANDO_DB="$ROOT/pando.sqlite" \
PANDO_CONFIG_DIR=config \
PANDO_WORKTREE_ROOT="$ROOT/worktrees" \
PANDO_DAEMON_ENABLED=1 \
PANDO_DAEMON_TICK_MS=1000 \
PANDO_GLOBAL_CONCURRENCY=1 \
PANDO_PORT=3210 \
  bun run start
```

Open dashboard:

```bash
open http://127.0.0.1:3210/dashboard
```

## Submit a brief

In another terminal, reuse the same `ROOT` value.

```bash
mkdir -p briefs/pando-small-task
$EDITOR briefs/pando-small-task/brief.md

PANDO_DB="$ROOT/pando.sqlite" \
  bun run pandoctl submit brief \
  --repo pando \
  --id pando-small-task \
  --branch chore/pando-small-task \
  --brief-path briefs/pando-small-task/brief.md
```

> CLI는 `pandoctl`이다 (ADR-010, npm 예약 이름). `bin/pandoctl.mjs`가 운영 CLI(`src/cli/agentctl.ts`)를 Bun으로 실행하며, `bun run pandoctl ...` / 전역 `pandoctl ...` / `bun src/cli/agentctl.ts ...`는 모두 같은 진입점이다. 내부 모듈 이름은 ADR-010에 따라 당분간 `agentctl`로 유지한다.

Dashboard submit은 인라인 자연어 brief가 기본이다. file-path submit은 advanced/debug path로 남긴다.

## Watch status

```bash
PANDO_API_URL=http://127.0.0.1:3210 \
  bun run pandoctl list

PANDO_DB="$ROOT/pando.sqlite" \
  bun run pandoctl show pando-small-task
```

## PR behavior

The `PR` stage is a real worker stage. The default pipeline asks Codex
(`gpt-5.5`) to:

1. run `bun run verify`
2. commit with an English message
3. push the branch
4. create a Draft PR against the repo base branch with `gh pr create`

Do not expose this server outside a private local network. Public auth is intentionally not implemented.

## Current friction found by self-dogfood

- The long env-var boot is now optional; `bun run pando start` (or the global `pando start`) covers the common local path. The env-var path stays for fine-grained control.
- To run multiple pando self-dogfood jobs concurrently, jobs should be queued before starting the daemon, and both `PANDO_GLOBAL_CONCURRENCY` and the repo profile `concurrency` must allow the desired count.
- The PR stage prompt says Draft PR, but recent self-dogfood produced non-draft PRs. Add a deterministic check or force `gh pr create --draft`.
- Evidence and temporary DB/worktrees should stay under `/tmp`; do not commit them.
