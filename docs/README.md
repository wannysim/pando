# pando docs

Most project docs are written in Korean. Start with the runbooks for operation,
then use the architecture and history sections when you need deeper context.

## Start Here

- [Local pando runner](./runbooks/local-pando-runner.md): local daemon/API,
  dashboard serving options, DB/worktree paths, and cleanup.
- [pandoctl runbook](./runbooks/agentctl.md): operator CLI modes, watch/list,
  retry/cancel/cleanup, and readiness smoke.
- [Two-job smoke runbook](./runbooks/two-job-smoke.md): host, full-daemon,
  Docker, live, and deterministic fallback smoke paths.
- [Soak failure analytics](./runbooks/soak-failure-analytics.md): 3-5 job
  soak/nightly runs and terminal failure summary evidence.

## Architecture

- [Repository structure](./repo-structure.md): directories, core interfaces, and
  module boundaries.
- [Multi-repo design](./design-v2-multi-repo.md): n-by-n orchestration design,
  repo profiles, worker stages, gates, and scheduling.
- [Operational readiness](./w5-operational-readiness.md): W5 dashboard/API,
  Docker shape, and readiness scenario matrix.

## Decisions

- [Architecture decision records](./adr/): accepted technical decisions. Read
  these before changing storage, worker engine, dashboard, MCP, context source,
  CLI naming, or release-branch behavior.

## Development

- [Engineering standards](./engineering-standards.md): TDD, verification,
  layering, deterministic gates, and repository discipline.
- [Current handoff](./handoff.md): current status, completed work, and next
  operational priorities.
- [Next session prompt](./next-session-prompt.md): ready-to-use prompt for
  continuing W6 operational expansion.

## Roadmap And History

- [Practical adoption roadmap](./practical-adoption-roadmap.md): current product
  boundary and remaining operational expansion work.
- [Initial research](./research-v1.md): early tooling and pattern research.
- [W1 runbook](./w1-runbook.md): first headless/worktree validation log.

## Other Entrypoints

- [Root README](../README.md): user-facing install, local run, dashboard, CLI,
  smoke, limitations, and security notes.
- [Brief template](../briefs/README.md): file-backed brief shape for CLI submit.
- [Docker deployment notes](../deploy/README.md): container mount and worker
  readiness details.
