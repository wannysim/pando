# Provider Retry/Backoff Policy Runbook

W6 #4. How pando classifies worker/engine failures and decides retry, backoff,
or escalation. All inputs are deterministic structured signals — never LLM
output text (CLAUDE.md 규율 5).

## Failure classification

`classifyProviderFailure` (`src/scheduler/retry-policy.ts`) maps a structured
`{ exitCode, timedOut, errorCode }` signal to one deterministic kind:

| Kind         | Signal |
|--------------|--------|
| `timeout`    | `timedOut === true`, or `exitCode === 124` |
| `auth`       | `errorCode` contains `unauthorized` / `not_logged_in` / `forbidden` / `401` / `403` / `auth` |
| `rate-limit` | `errorCode` contains `rate` / `429` / `too_many_requests` / `quota` |
| `transient`  | non-zero `exitCode` with no recognizable code |
| `unknown`    | clean exit / no signal |

Engine adapters (`claude-code`, `codex`) populate `exitCode` and `timedOut` on
`WorkerResult`. `errorCode` is reserved for structured JSON error fields; the
adapters do not parse stderr text into it.

## Retry decision

`decideRetry({ kind, attempt, maxAttempts, provider?, policies? })` returns
`{ retry, escalate, delayMs }`:

- **Non-retryable kinds** (default: `auth`) → `escalate: true`, no retry. The
  pipeline transitions `NON_RETRYABLE → ESCALATED` so the retry budget is
  preserved and the job is not looped on an unfixable failure (cost control).
- **Retryable kinds** retry with exponential backoff
  `min(maxDelayMs, baseDelayMsByKind[kind] * 2^(attempt-1))`. Defaults:
  `rate-limit` 30s base, `timeout` 5s, `transient`/`unknown` 2s, cap 5min.
- Once `attempt >= maxAttempts` (the stage retry budget), the job goes to
  `FAILED` via the normal `GATE_FAIL` budget exhaustion.

Gate failures (lint/test/checksum) are deterministic and keep their existing
`GATE_FAIL` retry behavior — only engine/worker failures are classified here.

## Per-provider overrides

`ProviderRetryPolicies` merges a `default` partial then a `byProvider[name]`
partial onto the built-in `defaultRetryPolicy()`. Pass it to `runPipeline` via
`retryPolicies`. Example: treat `rate-limit` as non-retryable for one engine.

## Telemetry

Engine failures emit `providerKind` and `backoffMs` in the `engine-fail` /
`stage-failed` event payload, and the failure reason includes the kind
(`<engine> returned ok=false (<kind>)`). The dashboard failure-reason histogram
(W6 #3) groups by that reason.

## Scheduler deferral

Retryable engine failures do not retry immediately inside the same pipeline
call. After the `GATE_FAIL` state transition, the daemon persists
`deferredUntil = now + backoffMs` and emits a `retry-deferred` event with
`backoffMs`, `deferredUntil`, and the deterministic provider failure reason.

`claimNextRunnable` skips active jobs with a future `deferredUntil`, so other
runnable jobs can use scheduler capacity while the provider backoff is cooling
down. Once the timestamp is due, the claim clears the deferral and resumes the
same stage with the already-consumed retry budget.
