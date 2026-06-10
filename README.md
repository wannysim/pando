# pando

English | [한국어](./README.ko.md)

pando runs coding-agent jobs for one or more Git repositories from a local
daemon. It creates isolated git worktrees, drives each job through a staged
pipeline, exposes an API/dashboard for operations, and stores queue state in
SQLite.

```text
SPEC -> PLAN -> TEST -> IMPL <-> REVIEW -> PR (draft)
```

Gate decisions use deterministic evidence such as exit codes, files, checksums,
and structured JSON. LLM output text is not used as a pass/fail signal.

## Requirements

- Node.js `>=22.13.0`.
- `bun@1.3.5`, the pinned package manager in `package.json`.
- `git`.
- Codex CLI (`codex`) with OpenAI auth configured. The default pipeline uses
  Codex for all stages with `gpt-5.5`; use `OPENAI_API_KEY` or persisted Codex
  auth.
- GitHub CLI (`gh`) with `gh auth status` passing. The PR stage uses `gh`.
- Optional: Docker for container checks, and Claude Code CLI (`claude`) only for
  legacy/custom stage profiles that still select `claude-code`.

Temporary DBs, worktrees, and smoke evidence should stay under `/tmp`; the
default local runner does this.

## Install

Use the checkout scripts for this repository snapshot.

```bash
git clone https://github.com/wannysim/pando.git
cd pando
bun install
```

Optional global commands from the checkout:

```bash
bun link
pandoctl start
```

The repo also contains a buildable `packages/pandoctl` distribution. The public
npm package may lag this checkout, so prefer the checkout commands unless you
know the installed `pandoctl` version matches these docs.

If you are using the published global command, update it with:

```bash
npm update -g pandoctl
```

## Local run

If you want the dashboard served by the same local pando server, build the
dashboard assets once:

```bash
bun --filter=@pando/dashboard run build
```

Start the local daemon/API:

```bash
bun run pando start
```

Startup output includes:

- API health URL, normally `http://127.0.0.1:3210/health`.
- Dashboard URL, normally `http://127.0.0.1:3210/dashboard`. In a source
  checkout, this uses `dashboard/dist` when that directory exists.
- SQLite DB path under `/tmp/pando-local-<timestamp>/pando.sqlite`.
- Worktree root under `/tmp/pando-local-<timestamp>/worktrees`.
- Stop and cleanup instructions.

If port `3210` is busy, pando tries the next free port and prints the URL it
actually used.

Full runner details: [docs/runbooks/local-pando-runner.md](./docs/runbooks/local-pando-runner.md).

## Dashboard Usage

The dashboard works when dashboard assets are served by the pando server, such
as in the Docker image or when `PANDO_STATIC_DASHBOARD_ROOT` points at a built
dashboard directory.

From a source checkout, the integrated dashboard path is:

```bash
bun --filter=@pando/dashboard run build
bun run pando start
```

Open the dashboard URL printed by `bun run pando start`.

For dashboard frontend development, run the Vite dev server against the local
API:

```bash
bun run pando start
VITE_PANDO_API_URL=http://127.0.0.1:3210 bun --filter=@pando/dashboard run dev
```

Open the Vite dashboard URL ending in `/dashboard/`.

The primary intake path is the inline natural-language brief form in the
dashboard.

To submit work from the dashboard:

1. Use the "Describe a task" form.
2. Set `Task repo`, for example `pando`.
3. Set a unique `Task ID`, for example `readme-demo`.
4. Describe what to build and add spec/doc/asset references one per line.
5. Submit the form. pando materializes a canonical `brief.md` outside the repo
   and enqueues the job.

Use the job list and detail view to inspect status, stage events, worktree path,
duration, and deterministic evidence.

## CLI Usage

`pandoctl` is the operator CLI. From the checkout, run it with `bun run pandoctl`.

List or watch jobs through the running API:

```bash
PANDO_API_URL=http://127.0.0.1:3210 bun run pandoctl list
PANDO_API_URL=http://127.0.0.1:3210 bun run pandoctl watch readme-demo
PANDO_API_URL=http://127.0.0.1:3210 bun run pandoctl daemon status
```

For detailed event history, use the DB path printed by `pando start`:

```bash
PANDO_DB=/tmp/pando-local-<timestamp>/pando.sqlite bun run pandoctl show readme-demo
```

File-backed brief submission is available for terminal workflows:

```bash
mkdir -p briefs/readme-demo
cat > briefs/readme-demo/brief.md <<'EOF'
# README Demo

## Goal

Make a small documentation-only change.

## User Story

As an operator, I want a clear local run check so that I can verify pando quickly.

## Acceptance Criteria

- [ ] The change is documented.

## Screens or Behavior

No UI change.

## Non-Goals

- Do not change source code.

## Assets

- None

## Open Questions

- None
EOF

PANDO_DB=/tmp/pando-local-<timestamp>/pando.sqlite \
  bun run pandoctl submit brief \
  --repo pando \
  --id readme-demo \
  --branch chore/readme-demo \
  --brief-path briefs/readme-demo/brief.md
```

Prefer `PANDO_API_URL` for live daemon reads and actions. Use `PANDO_DB` for
offline/local DB operations such as file-backed submit, `show`, and worktree
cleanup.

## Stop And Cleanup

- Stop the daemon with `Ctrl-C` in the terminal running `bun run pando start`.
- Remove the run root printed at startup, for example:

```bash
rm -rf /tmp/pando-local-<timestamp>
```

- To clean a single job worktree through pando, use the same DB path:

```bash
PANDO_DB=/tmp/pando-local-<timestamp>/pando.sqlite bun run pandoctl cleanup readme-demo
```

## Smoke And Readiness Checks

Host readiness smoke checks worker CLI availability, auth signals, mount/path
readiness, and concurrency cap without printing secrets:

```bash
bun run pandoctl smoke readiness --target host \
  --evidence /tmp/pando-readiness-smoke/host.json
```

For deterministic no-credential smoke evidence:

```bash
PANDO_GLOBAL_CONCURRENCY=2 \
  bun run smoke:two-job -- --mode fake \
  --evidence /tmp/pando-two-job-fake.json
```

Live worker and Docker smoke paths require valid local/container auth. Details:
[docs/runbooks/two-job-smoke.md](./docs/runbooks/two-job-smoke.md).

## Limitations

- pando is a local/private-network tool. Public API auth is not implemented.
- The default pipeline expects Codex/OpenAI auth and can spend OpenAI model
  credits.
- The PR stage can create commits, push branches, and open draft PRs through
  `gh`.
- Docker live workers need container-visible CLI auth or API keys; host-managed
  auth may not transfer into the container.
- The checkout `pando start` path starts the daemon/API and serves
  `dashboard/dist` when built. Without built assets, use the Vite dev server
  described above.

## Security Note

Do not expose the daemon/API to the public internet. Keep secrets out of briefs,
logs, docs, and committed files. Smoke evidence should stay under `/tmp` and
record only boolean auth signals or structured non-secret details.

## More Docs

Start with the docs map: [docs/README.md](./docs/README.md).
