/**
 * Provider retry/backoff policy — pure layer (CLAUDE.md 규율 4, no I/O).
 *
 * Worker/engine failures are classified into deterministic kinds from structured
 * signals only (exit codes, timeout booleans, structured error codes) — never
 * from LLM output text (CLAUDE.md 규율 5). The policy then decides whether to
 * retry, escalate, or stop, and how long to back off. Non-retryable kinds (auth)
 * escalate immediately instead of burning the retry budget.
 */

export type ProviderFailureKind = "auth" | "rate-limit" | "timeout" | "transient" | "unknown";

export interface FailureSignal {
  exitCode?: number;
  timedOut?: boolean;
  errorCode?: string;
}

export interface RetryPolicy {
  maxDelayMs: number;
  nonRetryableKinds: readonly ProviderFailureKind[];
  baseDelayMsByKind: Record<ProviderFailureKind, number>;
}

export interface ProviderRetryPolicies {
  default?: Partial<RetryPolicy>;
  byProvider?: Record<string, Partial<RetryPolicy>>;
}

export interface RetryDecisionInput {
  kind: ProviderFailureKind;
  attempt: number;
  maxAttempts: number;
  provider?: string;
  policies?: ProviderRetryPolicies;
}

export interface RetryDecision {
  kind: ProviderFailureKind;
  attempt: number;
  retry: boolean;
  escalate: boolean;
  delayMs: number;
}

const TIMEOUT_EXIT_CODE = 124;

export function defaultRetryPolicy(): RetryPolicy {
  return {
    baseDelayMsByKind: {
      auth: 0,
      "rate-limit": 30_000,
      timeout: 5_000,
      transient: 2_000,
      unknown: 2_000,
    },
    maxDelayMs: 300_000,
    nonRetryableKinds: ["auth"],
  };
}

export function classifyProviderFailure(signal: FailureSignal): ProviderFailureKind {
  if (signal.timedOut === true) return "timeout";

  const code = signal.errorCode?.toLowerCase() ?? "";
  if (matchesAny(code, ["unauthorized", "not_logged_in", "forbidden", "401", "403", "auth"])) {
    return "auth";
  }
  if (matchesAny(code, ["rate", "429", "too_many_requests", "quota"])) {
    return "rate-limit";
  }

  if (signal.exitCode === TIMEOUT_EXIT_CODE) return "timeout";
  if (signal.exitCode !== undefined && signal.exitCode !== 0) return "transient";
  return "unknown";
}

export function decideRetry(input: RetryDecisionInput): RetryDecision {
  const policy = resolvePolicy(input.provider, input.policies);

  if (policy.nonRetryableKinds.includes(input.kind)) {
    return { attempt: input.attempt, delayMs: 0, escalate: true, kind: input.kind, retry: false };
  }
  if (input.attempt >= input.maxAttempts) {
    return { attempt: input.attempt, delayMs: 0, escalate: false, kind: input.kind, retry: false };
  }

  return {
    attempt: input.attempt,
    delayMs: backoffMs(policy, input.kind, input.attempt),
    escalate: false,
    kind: input.kind,
    retry: true,
  };
}

function backoffMs(policy: RetryPolicy, kind: ProviderFailureKind, attempt: number): number {
  const base = policy.baseDelayMsByKind[kind];
  const scaled = base * 2 ** Math.max(0, attempt - 1);
  return Math.min(policy.maxDelayMs, Math.round(scaled));
}

function resolvePolicy(
  provider: string | undefined,
  policies: ProviderRetryPolicies | undefined,
): RetryPolicy {
  const base = defaultRetryPolicy();
  const merged = merge(base, policies?.default);
  if (provider === undefined) return merged;
  return merge(merged, policies?.byProvider?.[provider]);
}

function merge(base: RetryPolicy, override: Partial<RetryPolicy> | undefined): RetryPolicy {
  if (override === undefined) return base;
  return {
    baseDelayMsByKind: { ...base.baseDelayMsByKind, ...override.baseDelayMsByKind },
    maxDelayMs: override.maxDelayMs ?? base.maxDelayMs,
    nonRetryableKinds: override.nonRetryableKinds ?? base.nonRetryableKinds,
  };
}

function matchesAny(value: string, needles: readonly string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}
