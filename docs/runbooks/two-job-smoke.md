# Two-job smoke runbook

W5 PR 7 kept live validation intentionally small: exactly two jobs, with global concurrency set to 2 or 3. If CLI auth, provider auth, repo mounts, or cost controls are not ready, record deterministic fake smoke evidence instead.

There are now three live scopes:

- **Host worker probe**: two Codex worker jobs run in isolated directories and record deterministic exit-code evidence.
- **Host full daemon live dogfood**: two `pando` self-profile jobs run through `runDaemonOnce`, then a follow-up single pando dogfood job runs through the same host path.
- **Docker live worker smoke**: the same two Codex worker probes run inside the single-container runtime image. This verifies the Linux worker CLI layer, auth signal, CA bundle, and mount contract without running the full PR pipeline.

## Preconditions

- `PANDO_GLOBAL_CONCURRENCY` is `2` or `3`.
- SQLite is mounted at `/data/pando.sqlite`.
- Target repos are mounted under `/repos`.
- Worktrees are mounted under `/worktrees`.
- Runtime config is mounted at `/config`.
- Skills are mounted read-only at `/skills`.
- Codex/OpenAI authentication is available through `OPENAI_API_KEY` or a runtime-writable `CODEX_HOME`. Claude auth is only needed for legacy/custom profiles that select `claude-code`.

## Host worker readiness

Use this before a host-mode live worker smoke:

```bash
PANDO_GLOBAL_CONCURRENCY=2 \
  pnpm smoke:two-job -- --mode readiness --target host \
  --evidence /tmp/pando-host-readiness.json
```

The readiness evidence records:

- `globalConcurrency.value` and `withinLiveCap`
- `workerCli.commands.codex.available`
- auth signals as booleans only (`ANTHROPIC_API_KEY`, `CLAUDE_CONFIG_DIR`, `CLAUDE_CONFIG_FILE`, Claude config file presence/non-empty status, `OPENAI_API_KEY`, `CODEX_HOME`, Codex config dir writable). Only Codex/OpenAI auth blocks the default smoke.
- `gitCreds.signals` git push / PR credential presence as booleans only (deploy key, known_hosts, credential store, gitconfig, `GH_TOKEN` / `GITHUB_TOKEN`). Recorded, not a hard blocker; key/token values are never recorded
- host path readiness for SQLite parent, repos, worktrees, config, and skills

Do not commit evidence files; keep them under `/tmp` or another non-repo path. The
default evidence path `smoke/evidence/` is gitignored.

## Host live worker smoke

Run exactly two worker jobs with global cap 2 or 3:

```bash
mkdir -p /tmp/pando-live-worker-smoke

PANDO_GLOBAL_CONCURRENCY=2 \
PANDO_WORKTREE_ROOT=/tmp/pando-live-worker-smoke \
PANDO_SMOKE_RUN_ID="$(date +%Y%m%d-%H%M%S)" \
  pnpm smoke:two-job -- --mode live --target host \
  --evidence /tmp/pando-live-worker-smoke/live-worker-smoke.json
```

Success criteria:

- `mode` is `live`.
- `jobs` contains exactly `SMOKE-LIVE-CODEX-1` and `SMOKE-LIVE-CODEX-2`.
- both workers have `exitCode: 0` and `timedOut: false`.
- `checks.globalConcurrency.withinLiveCap` is `true`.
- `checks.worktreeCollision.pass` is `true`.
- `checks.providerCap.pass` is `true`.
- `checks.gateEvidence.pass` is `true`.

The smoke script records deterministic worker evidence (`exitCode`, `timedOut`, optional signal, stdout/stderr byte counts). It must not use LLM output text for pass/fail.

2026-06-06 host result: passed with global cap `2`. The old mixed Claude/Codex probe exited `0` for both workers. The current default probe is Codex-only and keeps the same deterministic exit-code evidence contract.

## Host full daemon contract smoke

Use this PR 1 contract before live full-daemon workers. It runs exactly two `pando` brief jobs through `runDaemonOnce` with the real host worktree provisioner, checked-in stage config, real `ClaudeCodeEngine`/`CodexEngine` adapter classes, and deterministic package-action gate classes. In `contract` mode, worker and gate process runners are injected fakes, so this path does not call Claude/Codex or judge LLM output text.

```bash
RUN_ID="contract-$(date +%Y%m%d-%H%M%S)"
ROOT="/tmp/pando-full-daemon-smoke-$RUN_ID"

pnpm smoke:full-daemon -- \
  --mode contract \
  --global-concurrency 2 \
  --worktree-root "$ROOT/worktrees" \
  --db "$ROOT/pando.sqlite" \
  --evidence "$ROOT/full-daemon-smoke.json" \
  --run-id "$RUN_ID"
```

Success criteria:

- `mode` is `contract`.
- `jobs` contains exactly `PANDO-FULL-SMOKE-1` and `PANDO-FULL-SMOKE-2`.
- both jobs finish `DONE`.
- `checks.twoJobsClaimed.actual` is `2`.
- `checks.globalConcurrency.value` is `2` or `3`, and `withinLiveCap` is `true`.
- `checks.worktreeCollision.pass` is `true`.
- `checks.providerCap.pass` is `true`.
- `checks.gateEvidence.pass` is `true`, with structured JSON evidence from `test`, `lint`, and `types` package-action gates.

2026-06-07 host contract result: passed with global cap `2`. Evidence: `/tmp/pando-full-daemon-smoke-contract-20260607-003713/full-daemon-smoke.json`. Both pando brief jobs finished `DONE`, worktree paths were distinct, provider usage was `{}`, and each job recorded three structured gate evidence entries. This is the baseline to run before live full-daemon workers.

## Host full daemon live dogfood

After the contract smoke passes, run the host full-daemon live smoke with exactly two `pando` self-profile jobs and global concurrency fixed at `2`. This path uses real Claude Code and Codex workers through `runDaemonOnce`.

```bash
RUN_ID="live-$(date +%Y%m%d-%H%M%S)"
ROOT="/tmp/pando-full-daemon-smoke-$RUN_ID"

pnpm smoke:full-daemon -- \
  --mode live \
  --global-concurrency 2 \
  --worktree-root "$ROOT/worktrees" \
  --db "$ROOT/pando.sqlite" \
  --evidence "$ROOT/full-daemon-smoke.json" \
  --run-id "$RUN_ID"
```

Success criteria:

- `mode` is `live`.
- `jobs` contains exactly `PANDO-FULL-SMOKE-1` and `PANDO-FULL-SMOKE-2`.
- both jobs finish `DONE`.
- `checks.twoJobsClaimed.actual` is `2`.
- `checks.globalConcurrency.value` is `2`, and `withinLiveCap` is `true`.
- `checks.worktreeCollision.pass`, `checks.providerCap.pass`, and `checks.gateEvidence.pass` are all `true`.
- DB events include real worker execution events, stage duration payloads, and structured gate evidence. If a worker fails, preserve the failure payload instead of relying on LLM output text.

2026-06-07 host live result:

- Baseline contract evidence: `/tmp/pando-full-daemon-smoke-contract-20260607-003713/full-daemon-smoke.json`.
- Initial live failure evidence: `/tmp/pando-full-daemon-smoke-live-20260607-003749/live-failure-evidence.json`.
- Live resume evidence: `/tmp/pando-full-daemon-smoke-live-20260607-003749/live-resume-evidence.json`.
- Follow-up dogfood evidence: `/tmp/pando-full-daemon-dogfood-20260607-010122/dogfood-evidence.json`.

The initial live run used exactly two jobs with global concurrency `2` and exposed a Codex TEST-stage stdin wait: both Codex workers reported `Reading additional input from stdin...` after termination. The first fix was to run Codex through `spawn(..., { stdio: ["ignore", "pipe", "pipe"] })` so process stdin is closed. A later self-benchmark exposed a separate noninteractive `write_stdin` failure inside Codex tool execution, so live workers and the default adapter now also run `codex exec --ephemeral --cd <worktree> --config 'approval_policy="never"' ...`. The same smoke contract should keep those flags aligned with `src/engines/codex.ts`.

## Docker worker readiness

The readiness smoke runs the same `pnpm smoke:two-job -- --mode readiness` contract
*inside the container*, against the `docker` target. It records, as structured JSON,
which class of blocker is open: CLI, auth, or mount. See `deploy/README.md`
"Worker readiness" for the full CLI/auth/git decision and tradeoffs.

### Step 1 — baseline (proves the blocker class)

After building the image, run a one-off container with only the base mount
contract (no CLI, no auth):

```bash
docker compose -f deploy/docker-compose.yml build pando
mkdir -p /tmp/pando-docker-readiness/data /tmp/pando-docker-readiness/evidence

docker run --rm \
  -e PANDO_GLOBAL_CONCURRENCY=2 \
  -e PANDO_DB=/data/pando.sqlite \
  -e PANDO_REPOS_ROOT=/repos \
  -e PANDO_WORKTREE_ROOT=/worktrees \
  -e PANDO_CONFIG_DIR=/config \
  -e PANDO_SKILLS_ROOT=/skills \
  -v /tmp/pando-docker-readiness/data:/data \
  -v "$HOME/Github":/repos \
  -v "$HOME/.worktrees":/worktrees \
  -v "$PWD/config":/config:ro \
  -v "$HOME/.ai-skills":/skills:ro \
  -v /tmp/pando-docker-readiness/evidence:/evidence \
  deploy-pando:latest \
  node scripts/two-job-smoke.mjs --mode readiness --target docker \
  --evidence /evidence/docker-readiness.json
```

### Step 2 — make workers ready

Pick a CLI strategy (`deploy/README.md` covers the tradeoffs):

- **macOS host:** build with the opt-in install layer (Dockerfile option B). The
  host's `~/.local/bin` binaries are Mach-O and will NOT run in the container.

  ```bash
  PANDO_INSTALL_WORKER_CLIS=true \
    docker compose -f deploy/docker-compose.yml build pando
  ```

  Versions pin via `PANDO_CLAUDE_CLI_VERSION` / `PANDO_CODEX_CLI_VERSION`
  (defaults `2.1.167` / `0.137.0`).
- **Linux host:** bind-mount the host CLI bin at `/worker-bin` (compose mount #1).

Then add the auth inputs and re-run with the CLI image. Important Docker auth details from the live attempt:

- Codex needs a writable `CODEX_HOME`; a read-only `~/.codex` mount can fail before the model call because the CLI writes local state.
- Claude Code host managed-connector files did not authenticate inside this macOS Docker environment, even when `.claude`, `.claude.json`, and matching `HOME` paths were mounted. Use `ANTHROPIC_API_KEY` or perform a container-local `claude /login` into a persisted, untracked Docker volume before expecting the Claude probe to pass.
- For host-file Claude mounts, mount both `~/.claude` and the top-level `~/.claude.json`. Do not force `CLAUDE_CONFIG_DIR=/root/.claude` for this path; in this environment that selected a zero-byte nested `.claude/.claude.json` and produced a readiness false positive before the non-empty check was added.
- The runtime image now installs `ca-certificates`; this removes the Codex `no native root CA certificates found` blocker observed during the first live attempt.

Re-run with the CLI image and the auth strategy you selected:

```bash
docker run --rm \
  -e PANDO_GLOBAL_CONCURRENCY=2 \
  -e PANDO_DB=/data/pando.sqlite -e PANDO_REPOS_ROOT=/repos \
  -e PANDO_WORKTREE_ROOT=/worktrees -e PANDO_CONFIG_DIR=/config \
  -e PANDO_SKILLS_ROOT=/skills \
  -e CODEX_HOME=/root/.codex \
  -v /tmp/pando-docker-readiness/data:/data \
  -v "$HOME/Github":/repos -v "$HOME/.worktrees":/worktrees \
  -v "$PWD/config":/config:ro -v "$HOME/.ai-skills":/skills:ro \
  -v "$HOME/.claude":/root/.claude:ro \
  -v "$HOME/.claude.json":/root/.claude.json:ro \
  -v "$HOME/.codex":/root/.codex \
  -v "$HOME/.ssh/id_ed25519":/root/.ssh/id_ed25519:ro \
  -v /tmp/pando-docker-readiness/evidence:/evidence \
  deploy-pando:latest \
  node scripts/two-job-smoke.mjs --mode readiness --target docker \
  --evidence /evidence/docker-readiness-cli-installed.json
```

The optional SSH deploy-key mount above lets the `gitCreds` probe report
`sshReady: true`; drop it for a CLI/auth-only check.

### Interpreting the evidence

- `checks.workerCli.commands.codex.available` -> CLI blocker.
- `checks.auth.signals.codex.configDirWritable` and `OPENAI_API_KEY` presence (booleans only) -> auth blocker. Claude auth signals are recorded for legacy/custom profiles but do not block the default Codex smoke.
- `checks.gitCreds.signals` (booleans + deploy-key path only) -> git push / PR
  credential presence. Recorded, not a hard blocker.
- `checks.mounts.paths.*.ready` -> mount blocker.
- `blockers[]` empty == ready for a live Docker worker smoke.

### 2026-06-07 Docker readiness result (verified in this environment)

- **Baseline** (`/tmp/pando-docker-readiness/evidence/docker-readiness.json`):
  mount contract `pass` and global cap `withinLiveCap: true`, but
  `blockers` = `[codex CLI not available, Codex auth not configured]` under the
  current Codex-only default. So the open blocker is **Codex CLI + auth**, not
  mounts.
- **Auth volume mounted** (`docker-readiness-mounted.json`): mounting only
  `~/.claude` / `~/.codex` at `/root/.claude` / `/root/.codex` is not enough for a
  reliable Claude signal. The Docker default checks top-level `/root/.claude.json`
  and now records `configFileNonEmpty`; a zero-byte nested `.claude/.claude.json`
  is a blocker, not a pass.
- **Host bin mounted, macOS host**: mounting `~/.local/bin` at `/worker-bin` did
  **not** make the CLI available — `workerCli.pass` stayed `false`. The host
  binaries are Mach-O arm64; the `linux/arm64` container cannot exec them. This is
  the recorded reason the host-bin shortcut fails on macOS.
- **Linux CLI installed in image** (`docker-readiness-cli-installed.json`): with
  the opt-in install layer (`PANDO_INSTALL_WORKER_CLIS=true`) plus auth signals,
  `workerCli.pass: true` (`claude 2.1.167`, `codex-cli 0.137.0`), `mounts.pass: true`.

### 2026-06-07 Docker live worker smoke attempt

Evidence root: `/tmp/pando-docker-live-worker-smoke-20260607/evidence`.

- `docker-readiness-pre-live.json`: with the installed CLI image and mounted auth dirs, readiness initially reported `blockers: []` before the auth probe was tightened. This exposed a false positive: directory presence alone is not enough for live auth.
- First `docker-live-worker-smoke.json`: both worker commands ran but exited `1`. Claude reported `Not logged in`; Codex reported `no native root CA certificates found`.
- Follow-up fixes in this branch:
  - runtime image installs `ca-certificates`, `git`, and `openssh-client`;
  - readiness records `claude.configFilePresent`, `claude.configFileNonEmpty`,
    and `codex.configDirWritable`;
  - read-only Codex auth dirs are blockers instead of false positives.
- Post-CA rerun (`docker-live-worker-smoke-post-ca.json`): readiness blockers were `[]`; Codex exited `0` (`timedOut=false`), confirming the CA layer fixed the image blocker. Claude still exited `1` with mounted host/copy config, confirming the remaining blocker is Docker Claude auth for legacy/custom `claude-code` profiles. The default pipeline is now Codex/OpenAI, so Claude live re-verification is optional unless a profile selects `claude-code`.

Task 3 rerun (`/tmp/pando-docker-live-worker-smoke-auth-20260607-120217/evidence`):
with the CLI image, CA bundle, writable Codex auth, SSH credential signal, and
top-level `/root/.claude.json` mounted, readiness blockers were `[]`, Codex exited
`0`, and Claude exited `1` (`timedOut=false`). A classified Claude-only check
matched the login blocker. The remaining action is to rerun with
`ANTHROPIC_API_KEY` or container-local `claude /login` credentials.

### Legacy Docker Claude auth commands

API-key mode:

```bash
export ANTHROPIC_API_KEY="<set locally; do not commit>"
RUN_ID="$(date +%Y%m%d-%H%M%S)"
ROOT="/tmp/pando-docker-live-worker-smoke-auth-$RUN_ID"
mkdir -p "$ROOT/data" "$ROOT/worktrees" "$ROOT/evidence"

PANDO_INSTALL_WORKER_CLIS=true docker compose -f deploy/docker-compose.yml build pando

docker run --rm \
  -e ANTHROPIC_API_KEY \
  -e PANDO_GLOBAL_CONCURRENCY=2 \
  -e PANDO_SMOKE_RUN_ID="$RUN_ID" \
  -e PANDO_DB=/data/pando.sqlite -e PANDO_REPOS_ROOT=/repos \
  -e PANDO_WORKTREE_ROOT=/worktrees -e PANDO_CONFIG_DIR=/config \
  -e PANDO_SKILLS_ROOT=/skills -e CODEX_HOME=/root/.codex \
  -v "$ROOT/data":/data -v "$HOME/Github":/repos \
  -v "$ROOT/worktrees":/worktrees -v "$PWD/config":/config:ro \
  -v "$HOME/.ai-skills":/skills:ro -v "$HOME/.codex":/root/.codex \
  -v "$ROOT/evidence":/evidence \
  deploy-pando:latest \
  node scripts/two-job-smoke.mjs --mode live --target docker \
  --evidence /evidence/docker-live-worker-smoke-api-key.json
```

Container-local login mode:

```bash
CLAUDE_AUTH_HOME="/tmp/pando-docker-claude-auth"
mkdir -p "$CLAUDE_AUTH_HOME"

docker run --rm -it \
  -e HOME=/auth \
  -v "$CLAUDE_AUTH_HOME":/auth \
  deploy-pando:latest \
  claude /login

RUN_ID="$(date +%Y%m%d-%H%M%S)"
ROOT="/tmp/pando-docker-live-worker-smoke-auth-$RUN_ID"
mkdir -p "$ROOT/data" "$ROOT/worktrees" "$ROOT/evidence"

docker run --rm \
  -e HOME=/auth \
  -e PANDO_GLOBAL_CONCURRENCY=2 \
  -e PANDO_SMOKE_RUN_ID="$RUN_ID" \
  -e PANDO_DB=/data/pando.sqlite -e PANDO_REPOS_ROOT=/repos \
  -e PANDO_WORKTREE_ROOT=/worktrees -e PANDO_CONFIG_DIR=/config \
  -e PANDO_SKILLS_ROOT=/skills -e CODEX_HOME=/root/.codex \
  -v "$ROOT/data":/data -v "$HOME/Github":/repos \
  -v "$ROOT/worktrees":/worktrees -v "$PWD/config":/config:ro \
  -v "$HOME/.ai-skills":/skills:ro -v "$CLAUDE_AUTH_HOME":/auth:ro \
  -v "$HOME/.codex":/root/.codex -v "$ROOT/evidence":/evidence \
  deploy-pando:latest \
  node scripts/two-job-smoke.mjs --mode live --target docker \
  --evidence /evidence/docker-live-worker-smoke-claude-login.json
```

Git push / PR credentials are recorded as `gitCreds` probe signals (deploy key or credential store, see `deploy/README.md`); mount one before the PR stage.

## Docker HTTP smoke

Before live workers, verify the single-container deployment shape:

```bash
docker compose -f deploy/docker-compose.yml up --build -d
curl -fsS http://127.0.0.1:3210/health
curl -fsSI http://127.0.0.1:3210/dashboard
curl -fsS -X POST http://127.0.0.1:3210/briefs \
  -H 'content-type: application/json' \
  -d '{"id":"docker-smoke-1","repo":"pando","title":"Docker smoke"}'
curl -fsS http://127.0.0.1:3210/jobs
docker compose -f deploy/docker-compose.yml down -v
```

2026-06-06 result: image build passed, compose container became `healthy`, `/health` returned JSON 200, `/dashboard` and dashboard static assets returned 200, and brief enqueue/list returned 200.

## Live checks

1. Submit exactly two jobs.
2. Confirm both jobs have distinct worktree paths.
3. Confirm provider usage never exceeds configured provider caps.
4. Confirm stage/gate events include deterministic evidence such as exit code, checksum, or structured JSON.

## Deterministic fallback

```bash
pnpm smoke:two-job -- --mode fake --evidence smoke/evidence/two-job-smoke-fake.json
```

Use fallback when live credentials, repo mounts, provider access, or cost approval are missing. The evidence file must include the fallback reason and the same four checks as the live smoke.

## Docker Claude credential mode (legacy/custom profiles)

In Docker, the Claude Code managed connector does not reliably inherit into the
container, so a read-only host-file mount is only a readiness signal — a live
Docker Claude worker needs `ANTHROPIC_API_KEY` or a container-local
`claude /login` credential. `deploy/docker-compose.yml` now forwards
`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` from the host env (empty by default, no
secret committed).

`resolveClaudeCredentialMode` (`src/daemon/claude-credential-mode.ts`) maps the
readiness auth signals to a deterministic mode, and the API surfaces it on
`GET /analytics` → `readiness.claude` so the dashboard shows it:

| Mode | Live-runnable | Meaning |
|------|---------------|---------|
| `api-key` | yes | `ANTHROPIC_API_KEY` is set |
| `host-file` (host target) | yes | complete `~/.claude` + `~/.claude.json` |
| `host-file-only` (docker target) | no | host-file signal only; connector may not inherit |
| `missing` | no | no API key and no complete config file |

Re-verify the Docker Claude live worker once a credential is available:

```bash
export ANTHROPIC_API_KEY='<set locally; do not commit>'
PANDO_GLOBAL_CONCURRENCY=2 PANDO_LIVE_SMOKE=1 \
  pnpm smoke:two-job -- --mode live --target docker \
  --evidence /tmp/pando-docker-claude-live.json
```

2026-06-07 status: re-verification is still credential-gated. On the dev host
`ANTHROPIC_API_KEY` was unset and only host-file signals were present, so the
deterministic resolution was `host-file-only` / not live-runnable with the
credential blocker above. The Docker daemon was up; the live worker call was not
run because no API-key/container-login credential was available. Run the command
above once a credential is provisioned to close the blocker.
