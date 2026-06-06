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

Early implementation. W1-W3 are complete; W4 n x n parallel scheduling is next. See the design docs under [docs/](./docs) (written in Korean):

- [research-v1.md](./docs/research-v1.md) — tooling & pattern research
- [design-v2-multi-repo.md](./docs/design-v2-multi-repo.md) — n×n design built on reusable agent-skill assets
- [repo-structure.md](./docs/repo-structure.md) — repo layout & core interfaces
- [engineering-standards.md](./docs/engineering-standards.md) — development methodology
- [adr/](./docs/adr) — architecture decision records

## Local run

> Full env-var and command reference: [docs/runbooks/local-pando-runner.md](./docs/runbooks/local-pando-runner.md)

**Worker expectations (post-PR #33):** Claude Code is required for all pipeline stages. `gh` is required for the PR creation stage. Evidence files and the temporary DB are written under `/tmp`, not inside the repo.

### Prerequisites

```bash
pnpm install
```

CLIs required: `claude` (Claude Code), `gh`, `git`. Ensure `gh auth status` passes and Claude auth is configured.

### Start the daemon and open the dashboard

Follow the [runbook](./docs/runbooks/local-pando-runner.md) "Start local pando" section to set env vars and run `pnpm start`, then open `http://127.0.0.1:3210/dashboard`.

### Submit a brief job

Follow the [runbook](./docs/runbooks/local-pando-runner.md) "Submit a brief" section to queue a job with your brief path.

### Check status and stop

Run `agentctl list` / `agentctl show <id>` to check progress (see runbook for the full commands). Stop: **Ctrl-C** the `pnpm start` process. Temporary artifacts live under `/tmp` and can be removed afterwards.

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
