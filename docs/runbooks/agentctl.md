# pandoctl runbook

`pandoctl` is the line-oriented operator CLI for pando. It speaks to the same
SQLite store and Hono API the daemon uses, so it has two distinct execution
modes. Pick the mode deliberately: they read and write the same job state but
through different boundaries.

> Naming: the published CLI is `pandoctl` (ADR-010 — the bare `pando` name is
> taken on npm). `pandoctl` is one binary: `pandoctl start` boots the local
> daemon/dashboard and the other subcommands operate the job store. `bin/pandoctl.mjs`
> resolves the unified entry `src/cli/pandoctl.ts`, which dispatches operational
> commands to the module still named `src/cli/agentctl.ts`. These are equivalent:
>
> ```bash
> pandoctl <command> [args]                       # global bin after `bun link` / `npm i -g .`
> bun run pandoctl <command> [args]                  # package script, no link required
> bun src/cli/agentctl.ts <command> [args]   # direct entrypoint
> ```
>
> Examples below use the direct entrypoint so they work from a fresh clone, but
> `pandoctl <command>` is the operator-facing name.

## Two modes

| | API-backed mode | Local DB mode |
|---|---|---|
| Trigger | `PANDO_API_URL` is set (or `apiClient` injected) | `PANDO_API_URL` is unset |
| Talks to | running daemon over HTTP | local SQLite file directly |
| Requires daemon running | yes | no |
| SQLite access | the daemon owns the file | this process opens `PANDO_DB` (default `/tmp/pando.sqlite`) |
| Auth boundary | private-network API (see ADR-009) | local filesystem only |

### API-backed mode (`PANDO_API_URL`)

Set `PANDO_API_URL` to the daemon base URL. Commands then route through the
HTTP API client, so they observe exactly what the running daemon sees and never
contend with the daemon for the SQLite handle.

```bash
PANDO_API_URL=http://127.0.0.1:3210 \
  bun src/cli/agentctl.ts list
```

These commands require API-backed mode because they read live daemon state:

- `list`, `list --watch`
- `daemon status`
- `watch <job-id>`

`retry` and `cancel` also prefer the API when `PANDO_API_URL` is set, so the
daemon applies the transition rather than a second writer.

If `PANDO_API_URL` is missing for a command that needs it, agentctl exits
non-zero with:

```
PANDO_API_URL is required for API-backed agentctl commands
```

### Local DB mode (no `PANDO_API_URL`)

With `PANDO_API_URL` unset, agentctl opens the SQLite store directly. Set
`PANDO_DB` to the DB path printed by `pandoctl start` when you want to inspect or
modify that local run. If `PANDO_DB` is omitted, the fallback is
`/tmp/pando.sqlite` so accidental commands do not create `pando.sqlite` in the
current directory.

```bash
bun src/cli/agentctl.ts submit brief \
  --repo pando --id pando-docs-ux --title "Improve docs UX"

bun src/cli/agentctl.ts show pando-docs-ux
```

Local-DB commands: `submit jira`, `submit brief`, `show <job-id>`,
`cleanup <job-id>`, and `retry`/`cancel` when no API URL is configured.

> Do not run local DB writes against the same `PANDO_DB` file while a daemon is
> running. Let one writer own the file at a time; otherwise use API-backed mode.

## Watching jobs

`watch` polls the API until the job reaches a terminal status (`DONE`,
`FAILED`, `ESCALATED`, `CANCELED`) or you press Ctrl-C. It re-renders one
status line per poll.

```bash
PANDO_API_URL=http://127.0.0.1:3210 \
  bun src/cli/agentctl.ts watch pando-docs-ux --interval 2000
```

`list --watch` re-renders the job table on each poll. It has no natural
terminal condition, so it loops until Ctrl-C unless you bound it with
`--max-polls`:

```bash
PANDO_API_URL=http://127.0.0.1:3210 \
  bun src/cli/agentctl.ts list --status IMPL --watch \
  --interval 2000 --max-polls 30
```

Options:

- `--interval <ms>`: poll interval, default `2000`.
- `--max-polls <n>`: stop after `n` polls. Optional for `watch`; the main way
  to bound `list --watch`.

## Readiness smoke

`smoke readiness` wraps the existing two-job readiness smoke
(`scripts/two-job-smoke.mjs --mode readiness`). It checks worker CLI
availability, auth signal presence, mount/path readiness, and the global
concurrency cap, then writes structured JSON evidence.

```bash
bun src/cli/agentctl.ts smoke readiness --target host
bun src/cli/agentctl.ts smoke readiness --target docker
```

- `--target host|docker`: which mount contract to check, default `host`.
- `--evidence <path>`: evidence output path, default
  `/tmp/pando-readiness-smoke/<target>.json`.

It prints only the target, the smoke exit code, and the evidence path, and
exits with the smoke exit code:

```
readiness smoke target=host exitCode=0 evidence=/tmp/pando-readiness-smoke/host.json
```

The command never prints secret values. The evidence records auth as boolean
signals (for example whether a config directory or API key env var is present),
not the secret contents. Inspect the evidence file for details.
