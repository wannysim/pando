# pandoctl

CLI for [**pando**](https://github.com/wannysim/pando) — a multi-repo background
coding agent orchestrator. One daemon spins up git worktrees across many repos and
drives coding-agent CLIs (claude/codex) through a SPEC → PLAN → TEST → IMPL ⇄ REVIEW → PR pipeline.

`pandoctl` is a single binary that both boots a local pando instance and operates
its job queue.

## Install

```bash
npm i -g pandoctl
# or run without installing
npx pandoctl <command>
```

The package bundles its own JavaScript; only `better-sqlite3` is a native
dependency and is resolved from its prebuilt binaries at install time. If a
prebuilt binary is unavailable for your platform, npm falls back to building it,
which needs a C/C++ toolchain (`node-gyp` prerequisites).

## Usage

```bash
pandoctl start                       # boot local daemon + dashboard + API
pandoctl submit brief --repo pando --id my-task --title "..."
pandoctl list
pandoctl show <job-id>
pandoctl retry <job-id> --from IMPL
pandoctl cancel <job-id>
pandoctl cleanup <job-id>
pandoctl watch <job-id>
pandoctl smoke readiness --target host
pandoctl help
```

`start` boots a local daemon/dashboard/API (defaults to
`http://127.0.0.1:3210/dashboard`). The other commands operate the same SQLite
job store, either directly (local DB mode) or through the running daemon's HTTP
API when `PANDO_API_URL` is set. See the
[runbooks](https://github.com/wannysim/pando/tree/main/docs/runbooks) for the two
execution modes and configuration details.

## Current limitations

- Do not expose the daemon/API outside a private local network — public auth is
  intentionally not implemented.
- `start` boots the API and daemon. The package does not bundle the dashboard
  SPA assets; the dashboard is served only when a built dashboard root is
  provided via `PANDO_STATIC_DASHBOARD_ROOT` (the Docker image, or a repo
  checkout after `pnpm --filter @pando/dashboard build`).

## Links

- Source: https://github.com/wannysim/pando
- Issues: https://github.com/wannysim/pando/issues

## License

MIT
