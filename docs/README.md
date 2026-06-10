# pando docs

This file is the only docs entrypoint for agent work. Its job is to tell you
which one or two documents to read next, not to preserve every project record.

Do not start from `handoff.md`, `practical-adoption-roadmap.md`, or
`next-session-prompt.md`. Those files are historical context or compatibility
stubs. Current decisions live in ADRs; current work routing lives here.

## Read Every Time

1. Read `CLAUDE.md` for non-negotiable engineering rules.
2. Read this file.
3. Pick exactly one task route below.
4. Read the relevant ADR only if the task changes a recorded decision.

For ordinary implementation work, do not read the whole `docs/` tree. If a
historical document conflicts with an ADR, code, or this file, treat the
historical document as stale.

## Active W6 Queue

Use the first unchecked item that matches the requested work. When closing an
item, update this list and the relevant runbook; do not create another handoff
document.

- [x] Docs/current-state sync: this README is now the source of truth for docs
      routing.
- [x] 3-5 job soak/nightly routine: `pnpm soak:nightly` writes aggregate
      structured evidence under `/tmp`.
- [x] Dashboard failure/readiness analytics: `GET /analytics` and the dashboard
      surface terminal failure reasons and readiness blockers from structured
      evidence.
- [x] Provider failure classification/backoff telemetry:
      `src/scheduler/retry-policy.ts` classifies deterministic provider failure
      kinds and records advisory `backoffMs`.
- [ ] Scheduler-enforced provider backoff deferral: advisory `backoffMs` is not
      yet a scheduler delay.
- [ ] Docker/OpenAI live worker smoke: re-verify the default Codex/OpenAI
      pipeline in Docker/host. Claude live smoke is only for legacy/custom
      `claude-code` profiles and needs `ANTHROPIC_API_KEY` or container-local
      `claude /login`.
- [ ] `pandoctl@0.1.0` npm publish: run release workflow dry-run, publish, then
      global install/update smoke.

Deferred until the queue above is closed: notifications, GitHub Issue/Jira
write-back, public auth hardening, Docker egress policy, split containers, TUI.

## Task Routes

- Local run or dashboard boot:
  [runbooks/local-pando-runner.md](./runbooks/local-pando-runner.md)
- Operator CLI behavior:
  [runbooks/agentctl.md](./runbooks/agentctl.md)
- Two-job, full-daemon, Docker, readiness, or live smoke:
  [runbooks/two-job-smoke.md](./runbooks/two-job-smoke.md)
- Soak/nightly evidence or failure summary:
  [runbooks/soak-failure-analytics.md](./runbooks/soak-failure-analytics.md)
- Provider retry/backoff work:
  [runbooks/provider-retry-policy.md](./runbooks/provider-retry-policy.md)
- `pandoctl` release or npm publish:
  [runbooks/pandoctl-release.md](./runbooks/pandoctl-release.md)
- Core architecture, module boundaries, or type contracts:
  [repo-structure.md](./repo-structure.md)
- Development discipline, test shape, or verification:
  [engineering-standards.md](./engineering-standards.md)

## Decisions

ADRs are the only durable record for binding decisions. Before changing storage,
worker engines, dashboard/API shape, MCP behavior, context sources, CLI naming,
or release branch routing, read the matching ADR under [adr/](./adr/).

If a historical note still matters as policy, promote it to a new ADR. Otherwise
leave it out of the active route.

## Archive / Records

These files are kept only to explain how the project got here. Do not use them
as the first source for new work:

- [handoff.md](./handoff.md): old session handoff and accumulated status log.
- [practical-adoption-roadmap.md](./practical-adoption-roadmap.md): roadmap log
  through the W5/W6 transition.
- [next-session-prompt.md](./next-session-prompt.md): compatibility pointer only.
- [research-v1.md](./research-v1.md): initial research; re-check any volatile
  tool/model/pricing facts before use.
- [design-v2-multi-repo.md](./design-v2-multi-repo.md): design history; ADRs and
  current code win on conflict.
- [w1-runbook.md](./w1-runbook.md): first validation log.
- [w5-operational-readiness.md](./w5-operational-readiness.md): W5 plan and
  scenario matrix; many live-smoke notes are superseded by current runbooks.

## Other Entrypoints

- [Root README](../README.md): user-facing install, local run, dashboard, CLI,
  smoke, limitations, and security notes.
- [Brief template](../briefs/README.md): file-backed brief shape for CLI submit.
- [Docker deployment notes](../deploy/README.md): container mount and worker
  readiness details.
