# Docker Deployment

This is the W5 single-container runtime. One container owns the Node daemon process, Hono API, static dashboard assets, SQLite file, and the minimal runtime tools needed by workers (`ca-certificates`, `git`, `openssh-client`). Worker CLIs are still opt-in so the default image stays secret-free.

## Mount Contract

- SQLite: `/data/pando.sqlite`
- Target repositories: `/repos`
- Worktrees: `/worktrees`
- Runtime config: `/config`
- Skills: `/skills`
- HTTP port: `3210`

The compose default keeps `PANDO_GLOBAL_CONCURRENCY=2` so first live smoke runs stay inside the W5 cap of 2-3 jobs. Raise it only after the two-job smoke evidence is recorded.

## Run

```bash
docker compose -f deploy/docker-compose.yml up --build
```

Dashboard assets are served from `/dashboard`; API routes such as `/health` and `/jobs` remain JSON routes on the same origin.

## Worker readiness

The base image only verifies the HTTP/API/dashboard skeleton. The default
pipeline (`SPEC -> PLAN -> TEST -> IMPL -> REVIEW -> PR`) shells out to the
`codex` worker CLI with OpenAI auth. Claude Code is only needed for
legacy/custom profiles that explicitly select `claude-code`. Worker CLI auth and
git credentials are not in the image by design.

### CLI strategy

The base image does **not** bake in `codex` or optional `claude`. Reasons: auth
cannot be baked (it lives in `OPENAI_API_KEY` / `CODEX_HOME`, and optionally
`~/.claude` for legacy profiles), no secrets in the image (CLAUDE.md rule 5),
and the host already runs tested CLI versions. There are two ways to make the
CLIs available at runtime, and
**which one works depends on your host OS/arch**:

**A. Bind-mount the host CLI bin (Linux host only).** The runtime image sets
`PANDO_WORKER_BIN=/worker-bin` and prepends `/worker-bin` to `PATH`. Mount the
host bin that holds `codex` there and it resolves without a rebuild. Mount
`claude` too only for legacy/custom profiles.

> Verified blocker on macOS: on an Apple-silicon host, `~/.local/bin/{claude,codex}`
> are **Mach-O arm64** binaries. Bind-mounting them into the `linux/arm64`
> container leaves them non-executable there — the readiness probe still reports
> `workerCli.pass: false` even though the files are mounted. So option A only works
> when the host and container share OS **and** arch (i.e. a Linux host).

**B. Install the Linux CLI in the image (recommended for a macOS host).** This is
now an opt-in, version-pinned layer in the Dockerfile — no manual edit needed.
Build with the install flag on:

```bash
PANDO_INSTALL_WORKER_CLIS=true docker compose -f deploy/docker-compose.yml build pando
# or directly:
docker build -f deploy/Dockerfile --build-arg INSTALL_WORKER_CLIS=true .
```

Versions are pinned via build args so the shipped image matches the tested host
CLIs (defaults: `CLAUDE_CLI_VERSION=2.1.167`, `CODEX_CLI_VERSION=0.137.0`; override
with `PANDO_CLAUDE_CLI_VERSION` / `PANDO_CODEX_CLI_VERSION`). Default is `false`, so
the base image stays lean and secret-free. Then provide auth (below). This yields
a self-contained, cross-platform image at the cost of a larger image. Verified
2026-06-07: this layer makes the docker readiness probe report Codex CLI
availability, and it can also install Claude for legacy profiles. The runtime
image also installs `ca-certificates`; without it Codex can fail live calls with
`no native root CA certificates found`.

### Auth strategy and the managed-connector question

`ADR-004` fixed the host worker auth model: the headless `claude` CLI **inherits
the claude.ai managed connector** rather than receiving an injected
`--mcp-config`. That inheritance reads from `~/.claude` on the host.

In this macOS Docker environment, that inheritance **does not survive inside the
container**. Live probes with mounted host `.claude`, `.claude.json`, matching
`HOME`, and a copied config directory still returned `Not logged in · Please run /login`.
Treat mounted Claude host files as a readiness signal only, not as proof of usable
live model auth.

Supported Docker auth paths are now:

1. **OpenAI API-key mode for Docker live smoke** — set `OPENAI_API_KEY` from the
   host env or an untracked `.env` file. Never commit this value.
2. **Writable Codex home** — mount a writable `CODEX_HOME` such as `/root/.codex`
   if you use persisted Codex auth instead of `OPENAI_API_KEY`.
3. **Legacy Claude API-key mode** — set `ANTHROPIC_API_KEY` only when a
   legacy/custom profile selects `claude-code`.
4. **Legacy container-local Claude login** — run `claude /login` inside a throwaway or
   persisted, untracked Docker volume, then mount that volume as the container's
   Claude config. This keeps secrets out of the image but avoids macOS keychain /
   host connector assumptions.
5. **Jira REST fallback** — if the Atlassian MCP connector specifically cannot be
   inherited, intake/context can fall back to direct Jira REST with a host-provided
   token instead of the MCP tool. This remains an ADR candidate before product use.

Codex auth has a separate runtime constraint: `CODEX_HOME` must be writable for
live runs because the CLI writes local state before/during model calls. A
read-only `~/.codex` mount can pass directory-presence checks but fail live.

### Git credentials / deploy key

The PR stage needs to push and open PRs from inside the container. Mount one of
the following read-only (compose carries both as commented opt-in lines):

- **Deploy key (preferred for a single repo):** mount a read-only SSH private key
  to `/root/.ssh/id_ed25519` plus a `known_hosts`, and point the repo remote at
  SSH. Scope the key to the one repo pando writes to.
- **HTTPS token via git credential store:** mount a host-managed
  `~/.git-credentials` and `~/.gitconfig` read-only. Works with `gh` / token auth.
  A `GH_TOKEN` / `GITHUB_TOKEN` env value also counts as an HTTPS credential source.

Never bake a key or token into the image and never commit any secret value. The
readiness probe records git-credential **presence** as booleans (and the deploy-key
path for diagnostics) — never the key or token value (see below).

The mount points the probe and compose use:

- Deploy key: `/root/.ssh/id_ed25519` (override `PANDO_DEPLOY_KEY`), plus
  `/root/.ssh/known_hosts` (override `PANDO_SSH_KNOWN_HOSTS`).
- Credential store: `/root/.git-credentials` (override `PANDO_GIT_CREDENTIALS`),
  plus `/root/.gitconfig` (override `PANDO_GITCONFIG`).

## Reading the readiness evidence

`node scripts/two-job-smoke.mjs --mode readiness --target docker` (run inside the
container, see `docs/runbooks/two-job-smoke.md`) writes structured JSON that
pinpoints which class of blocker is open:

- `checks.workerCli.commands.claude/codex.available` — CLI blocker (mount #1 missing).
- `checks.auth.signals.claude.configFilePresent` — Claude config-file presence
  blocker when no `ANTHROPIC_API_KEY` is provided. Booleans only; no secret values
  are recorded. Note: presence still does not prove managed connector inheritance
  works in Docker; the live probe is the final check.
- `checks.auth.signals.codex.configDirWritable` — Codex auth-home writability
  blocker when no `OPENAI_API_KEY` is provided.
- `checks.gitCreds.signals` — git push / PR credential presence: `deployKeyPresent`,
  `knownHostsPresent`, `credentialStorePresent`, `gitconfigPresent`, `tokenEnvPresent`,
  plus `sshReady` / `httpsReady` and an overall `gitCreds.pass`. Booleans only
  (`deployKeyPath` is a path, never the key contents).
- `checks.mounts.paths.*.ready` — mount/path blocker (repos, worktrees, config,
  skills, SQLite parent).
- `blockers[]` — the consolidated, human-readable list. Empty means ready.

`gitCreds` is **recorded but not a hard blocker**: the worker probe never pushes,
so a missing deploy key / credential store does not fail readiness. It surfaces the
PR-stage prerequisite so you can confirm push/PR creation will work before a full
pipeline run. `gitCreds.pass: false` with everything else green means workers can
run but the PR stage still needs a credential mount.

2026-06-07 live attempt summary: the Docker live worker probe ran inside the CLI
image. Codex initially failed because the image lacked native CA certificates; the
runtime now installs `ca-certificates`, and the post-CA rerun had Codex exit `0`
with readiness blockers `[]`. Claude still failed with `Not logged in` because the
host managed connector did not authenticate inside the container. Next live pass
requires `ANTHROPIC_API_KEY` or a container-local `claude /login` credential.
