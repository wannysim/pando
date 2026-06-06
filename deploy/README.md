# Docker Deployment

This is the W5 single-container skeleton. One container owns the Node daemon process, Hono API, static dashboard assets, and SQLite file.

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

The base image only verifies the HTTP/API/dashboard skeleton. The pipeline
(`SPEC -> PLAN -> TEST -> IMPL -> REVIEW -> PR`) shells out to the `claude` and
`codex` worker CLIs, and those CLIs need auth and git credentials. None of that is
in the image by design.

### CLI strategy

The base image does **not** bake in `claude` / `codex`. Reasons: auth cannot be
baked (it lives in `~/.claude` / `~/.codex` on the host and must be mounted either
way), no secrets in the image (CLAUDE.md rule 5), and the host already runs tested
CLI versions. There are two ways to make the CLIs available at runtime, and
**which one works depends on your host OS/arch**:

**A. Bind-mount the host CLI bin (Linux host only).** The runtime image sets
`PANDO_WORKER_BIN=/worker-bin` and prepends `/worker-bin` to `PATH`. Mount the
host bin that holds `claude`/`codex` there and they resolve without a rebuild.

> Verified blocker on macOS: on an Apple-silicon host, `~/.local/bin/{claude,codex}`
> are **Mach-O arm64** binaries. Bind-mounting them into the `linux/arm64`
> container leaves them non-executable there — the readiness probe still reports
> `workerCli.pass: false` even though the files are mounted. So option A only works
> when the host and container share OS **and** arch (i.e. a Linux host).

**B. Install the Linux CLI in the image (recommended for a macOS host).** Add an
install layer to the Dockerfile runtime stage:

```dockerfile
RUN npm install -g @anthropic-ai/claude-code @openai/codex
```

Then mount only the auth volumes (below). This yields a self-contained,
cross-platform image at the cost of version pinning and a larger image.

### Auth strategy and the managed-connector question

`ADR-004` fixed the host worker auth model: the headless `claude` CLI **inherits
the claude.ai managed connector** rather than receiving an injected
`--mcp-config`. That inheritance reads from `~/.claude` on the host.

Whether that inheritance survives *inside the container* is **not yet verified
live** (no live Docker worker smoke has run — see the runbook for why). Two
outcomes, in order of preference:

1. **Connector inheritance works.** Mount `~/.claude` (and `~/.codex`) read-only at
   `/root/.claude` and `/root/.codex`. No API key needed. This is the default the
   compose comments describe.
2. **Connector inheritance does NOT work in the container.** Then fall back to:
   - **API-key mode** — set `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` from the host env
     or an untracked `.env` file (never committed). This bypasses the managed
     connector for model access.
   - **Jira REST fallback** — if the Atlassian MCP connector specifically cannot be
     inherited, intake/context can fall back to direct Jira REST with a host-provided
     token instead of the MCP tool.

   Both fallbacks are **ADR candidates**, not yet decided. They would amend or
   sit beside ADR-004 (which currently assumes host connector inheritance). Do not
   treat them as implemented until a live Docker smoke confirms which path is
   needed and a new ADR records it.

### Git credentials / deploy key

The PR stage needs to push and open PRs from inside the container. Mount one of
the following read-only (compose carries both as commented opt-in lines):

- **Deploy key (preferred for a single repo):** mount a read-only SSH private key
  to `/root/.ssh/id_ed25519` plus a `known_hosts`, and point the repo remote at
  SSH. Scope the key to the one repo pando writes to.
- **HTTPS token via git credential store:** mount a host-managed
  `~/.git-credentials` and `~/.gitconfig` read-only. Works with `gh` / token auth.

Never bake a key or token into the image and never commit any secret value.

## Reading the readiness evidence

`node scripts/two-job-smoke.mjs --mode readiness --target docker` (run inside the
container, see `docs/runbooks/two-job-smoke.md`) writes structured JSON that
pinpoints which class of blocker is open:

- `checks.workerCli.commands.claude/codex.available` — CLI blocker (mount #1 missing).
- `checks.auth.signals.claude/codex` — auth blocker (mount #2 / API key missing).
  Booleans only; no secret values are recorded.
- `checks.mounts.paths.*.ready` — mount/path blocker (repos, worktrees, config,
  skills, SQLite parent).
- `blockers[]` — the consolidated, human-readable list. Empty means ready.

Git-credential readiness is not a probe field yet; treat a missing deploy
key / credential store as a known prerequisite for the PR stage (documented above).
