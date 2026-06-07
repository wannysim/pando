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

## Nightly Aggregation

`smoke:full-daemon` runs a single soak run. `soak:nightly` runs several soak
iterations back-to-back and aggregates them into one nightly summary so a
repeated routine produces a stable, scannable pass-rate signal. Each iteration
is a full `runHostFullDaemonSmoke` run with its own DB, worktree root, and
evidence under a per-iteration directory.

```bash
pnpm soak:nightly -- \
  --mode contract \
  --iterations 3 \
  --jobs 3 \
  --global-concurrency 2 \
  --run-id "nightly-$(date +%Y%m%d)"
```

Defaults are `--mode contract`, `--iterations 3`, `--jobs 3`. The output root
defaults to `/tmp/pando-soak-nightly/<run-id>` and can be overridden with
`--output-dir`. Use `--mode live` only when worker CLI auth and credentials are
ready (it can spend model credits). The command exits non-zero when the
aggregate is not fully green, so it can gate a nightly job.

The aggregate summary at `<output-dir>/nightly-summary.json` contains:

- `mode`, `iterations`, `jobsPerIteration`, `totalJobs`
- `totals` summed across all iterations (same shape as a single run)
- `passRate` (`success / totalJobs`, rounded to 4 decimals) and `ok`
  (true only when every job succeeded and at least one job ran)
- `failureReasons`: a histogram of `{terminalStatus, reason, count}` for every
  non-success terminal job, sorted by count then status then reason
- `iterationsBreakdown`: per-iteration `runId`, evidence/failure-summary paths,
  `totals`, `totalJobs`, and `passRate`

Per-iteration evidence and failure summaries live under
`<output-dir>/iteration-<n>/`. The aggregation reuses each run's deterministic
`failure-summary.json`, so no raw worker output reaches the nightly summary.
Keep all evidence under `/tmp` and do not commit it.
