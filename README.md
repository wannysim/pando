# pando

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

Design stage. See the design docs under [docs/](./docs) (written in Korean):

- [research-v1.md](./docs/research-v1.md) — tooling & pattern research
- [design-v2-multi-repo.md](./docs/design-v2-multi-repo.md) — n×n design built on reusable agent-skill assets
- [repo-structure.md](./docs/repo-structure.md) — repo layout & core interfaces
- [engineering-standards.md](./docs/engineering-standards.md) — development methodology
- [adr/](./docs/adr) — architecture decision records

## Development

```bash
pnpm install
pnpm verify   # coverage + lint + types — required before every commit
```

Discipline: no implementation code without a failing test first (RED-GREEN-REFACTOR) · atomic commits (~100 lines) · architecture decisions go in an ADR. See [CLAUDE.md](./CLAUDE.md).
