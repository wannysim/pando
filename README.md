# pando

English | [한국어](./README.ko.md)

> Multi-repo background coding agent orchestrator — **one root system, many trunks.**

[Pando](https://en.wikipedia.org/wiki/Pando_(tree)) is the largest known single organism on Earth: a quaking-aspen clone of ~47,000 stems sharing one root system. This project mirrors that — one orchestrator (the root) grows git worktrees (stems) across many repos, and coding agents implement tickets on each stem.

## What it does

Feed it a Jira ticket (or a brief drafted from chat) and it runs:

```
SPEC → PLAN → TEST → IMPL ⇄ REVIEW → PR (draft)
```

Each stage runs inside an isolated git worktree, executed by a coding-agent CLI (Claude Code / Codex). Gates between stages are judged **only by deterministic signals** — exit codes, file artifacts, checksums. An agent claiming "done" is never trusted.

It processes many repos × many tickets in flight, distinguishing company repos (Jira/Confluence/Figma) from personal repos (brief-based) through per-repo profiles.

## Status

Early implementation. A one-command local run (`pandoctl start`, also `pando start`) boots the daemon and dashboard, inline natural-language brief intake is available in the dashboard/API, and brief-based self-dogfood against the pando repo works. Host worker smoke and host full-daemon dogfood have passed; Docker worker readiness is narrowed to explicit CLI/auth/git evidence. The operational CLI now ships as a buildable `pandoctl` npm package that unifies local start and job operations under one binary. See the design docs under [docs/](./docs) (written in Korean):

- [research-v1.md](./docs/research-v1.md) — tooling & pattern research
- [design-v2-multi-repo.md](./docs/design-v2-multi-repo.md) — n×n design built on reusable agent-skill assets
- [repo-structure.md](./docs/repo-structure.md) — repo layout & core interfaces
- [engineering-standards.md](./docs/engineering-standards.md) — development methodology
- [adr/](./docs/adr) — architecture decision records

## Install

The operational CLI is published as **`pandoctl`** — one binary that both boots a local pando instance (`pandoctl start`) and operates the job queue (`pandoctl list/show/submit/...`).

```bash
npm i -g pandoctl     # or: npx pandoctl <command>
pandoctl start        # boot local daemon + dashboard + API
pandoctl help
```

The package bundles its own JavaScript; only `better-sqlite3` is native and is resolved from prebuilt binaries at install time. The package does not bundle the dashboard SPA assets — `pandoctl start` serves the API/daemon, and the dashboard is served only when a built dashboard root is provided via `PANDO_STATIC_DASHBOARD_ROOT` (the Docker image, or a repo checkout that has built the dashboard). Do not expose the daemon/API outside a private local network; public auth is intentionally not implemented.

To build and pack the distribution from a checkout: `pnpm build:pandoctl` then `pnpm smoke:pandoctl-pack` (the smoke writes structured evidence under `/tmp`).

## Local run

> Full env-var and command reference: [docs/runbooks/local-pando-runner.md](./docs/runbooks/local-pando-runner.md)

**Worker expectations (post-PR #33):** Claude Code is required for all pipeline stages. `gh` is required for the PR creation stage. Evidence files and the temporary DB are written under `/tmp`, not inside the repo.

### Prerequisites

```bash
pnpm install
```

CLIs required: `claude` (Claude Code), `gh`, `git`. Ensure `gh auth status` passes and Claude auth is configured.

### Start the daemon and open the dashboard

One command boots a local DB, worktree root, config, dashboard, and daemon under a `/tmp` run root:

```bash
pnpm pando start            # or `pando start` after `pnpm link --global`
```

It prints the dashboard URL (`http://127.0.0.1:3210/dashboard`), the DB path, the worktree root, and how to stop and clean up. For the manual env-var path, see the [runbook](./docs/runbooks/local-pando-runner.md) "Start local pando (manual env path)" section.

### Submit a brief job

Use the dashboard inline brief form for the normal path: write the natural-language request and optional spec/doc/asset references, and pando materializes the canonical `brief.md` outside the repo before enqueueing. The file-path brief submit flow still exists as an advanced/operator path; see the [runbook](./docs/runbooks/local-pando-runner.md) "Submit a brief" section.

### Check status and stop

The CLI is **`pandoctl`** (published on [npm](https://www.npmjs.com/package/pandoctl); the bare `pando` name was taken — see [ADR-010](./docs/adr/010-cli-name-pandoctl.md)). It is one binary: `pandoctl start` boots the daemon (the `pando start` command above is the same bootstrap), and the other subcommands operate the job queue. Run any of these equivalents:

```bash
pnpm pandoctl list          # package script (prefix with PANDO_API_URL=... to reach a running daemon)
pandoctl list               # global bin (npm i -g pandoctl, or `pnpm link --global` from a checkout)
pnpm pandoctl show <id>
```

See the runbook for the full env-var prefixes. Stop: **Ctrl-C** the `pandoctl start` (or `pnpm start`) process. Temporary artifacts live under `/tmp` and can be removed afterwards.

## Development

```bash
pnpm install
pnpm verify   # coverage + lint + types — required before every commit
```

Discipline: no implementation code without a failing test first (RED-GREEN-REFACTOR) · atomic commits (~100 lines) · architecture decisions go in an ADR. See [CLAUDE.md](./CLAUDE.md).

## Branching and releases

This repository uses Git Flow:

- `main`: protected release branch
- `develop`: integration branch
- `feature/*`, `release/*`, `hotfix/*`: working branches
- release tags do not use a `v` prefix, for example `0.1`

Commit messages are written in English. Run `pnpm verify` before every commit.
