# Soak Failure Analytics Runbook

Use this W6 runbook when you need a reproducible 3-5 job pando self-profile
soak/nightly run and deterministic terminal failure evidence.

## Contract Soak

Contract mode exercises the host daemon wiring, real stage config, real
worktree provisioner, real engine adapter classes, and deterministic gate
classes. Worker and gate process runners are fakes, so it does not spend model
credits.

```bash
RUN_ID="soak-contract-$(date +%Y%m%d-%H%M%S)"
ROOT="/tmp/pando-full-daemon-smoke-$RUN_ID"

pnpm smoke:full-daemon -- \
  --mode contract \
  --jobs 3 \
  --global-concurrency 2 \
  --worktree-root "$ROOT/worktrees" \
  --db "$ROOT/pando.sqlite" \
  --evidence "$ROOT/full-daemon-smoke.json" \
  --failure-summary "$ROOT/failure-summary.json" \
  --run-id "$RUN_ID"
```

Increase `--jobs` to `4` or `5` for a larger soak. Keep
`--global-concurrency` at `2` or `3` for the current live cap.

## Live Soak

Live mode uses real worker CLIs and can spend model credits. Run it only when
Claude Code auth, GitHub CLI auth, and repo credentials are ready.

```bash
RUN_ID="soak-live-$(date +%Y%m%d-%H%M%S)"
ROOT="/tmp/pando-full-daemon-smoke-$RUN_ID"

pnpm smoke:full-daemon -- \
  --mode live \
  --jobs 3 \
  --global-concurrency 2 \
  --worktree-root "$ROOT/worktrees" \
  --db "$ROOT/pando.sqlite" \
  --evidence "$ROOT/full-daemon-smoke.json" \
  --failure-summary "$ROOT/failure-summary.json" \
  --run-id "$RUN_ID"
```

## Evidence

The main evidence file contains:

- `checks.jobsClaimed` with the expected and actual job count.
- `jobs[*].id`, `jobs[*].finalStatus`, `jobs[*].worktreePath`, stage events,
  and gate evidence.
- `failureSummary.path`, `failureSummary.totals`, and the full terminal
  summary.

The failure summary file contains one entry per job with:

- `jobId`
- `finalStatus`
- `terminalStatus` (`success`, `failure`, `timeout`, `cancel`, `escalated`, or
  `running`)
- `stage`
- `reason`
- `durationMs`
- `retryCount`
- deterministic evidence `path` and sanitized `summary`

Job-level evidence files are written under
`$(dirname "$ROOT/failure-summary.json")/job-evidence/`. Raw worker stdout,
stderr, message text, and other sensitive payload keys are omitted or reduced to
byte counts.

Keep all evidence under `/tmp` and do not commit it.
