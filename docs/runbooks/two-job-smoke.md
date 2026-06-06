# Two-job smoke runbook

W5 PR 7 keeps live validation intentionally small: exactly two jobs, with global concurrency set to 2 or 3. If CLI auth, provider auth, repo mounts, or cost controls are not ready, record deterministic fake smoke evidence instead.

## Preconditions

- `PANDO_GLOBAL_CONCURRENCY` is `2` or `3`.
- SQLite is mounted at `/data/pando.sqlite`.
- Target repos are mounted under `/repos`.
- Worktrees are mounted under `/worktrees`.
- Runtime config is mounted at `/config`.
- Skills are mounted read-only at `/skills`.
- Claude and Codex authentication are available through API keys or auth volumes.

## Live checks

1. Submit exactly two jobs.
2. Confirm both jobs have distinct worktree paths.
3. Confirm provider usage never exceeds configured provider caps.
4. Confirm stage/gate events include deterministic evidence such as exit code, checksum, or structured JSON.

## Deterministic fallback

```bash
pnpm smoke:two-job -- --mode fake --evidence smoke/evidence/two-job-smoke-fake.json
```

Use fallback when live credentials, repo mounts, provider access, or cost approval are missing. The evidence file must include the fallback reason and the same four checks as the live smoke.
