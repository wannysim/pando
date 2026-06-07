import { describe, expect, it } from "vitest";
import {
  classifyProviderFailure,
  decideRetry,
  defaultRetryPolicy,
  type ProviderRetryPolicies,
} from "../../src/scheduler/retry-policy";

describe("classifyProviderFailure", () => {
  it("classifies a timed-out worker as timeout regardless of exit code", () => {
    expect(classifyProviderFailure({ exitCode: 1, timedOut: true })).toBe("timeout");
    expect(classifyProviderFailure({ exitCode: 124 })).toBe("timeout");
  });

  it("classifies known auth and rate-limit error codes deterministically", () => {
    expect(classifyProviderFailure({ errorCode: "not_logged_in" })).toBe("auth");
    expect(classifyProviderFailure({ errorCode: "401 Unauthorized" })).toBe("auth");
    expect(classifyProviderFailure({ errorCode: "rate_limit_exceeded" })).toBe("rate-limit");
    expect(classifyProviderFailure({ errorCode: "HTTP 429" })).toBe("rate-limit");
  });

  it("treats a non-zero exit with no recognizable code as transient and a clean exit as unknown", () => {
    expect(classifyProviderFailure({ exitCode: 1 })).toBe("transient");
    expect(classifyProviderFailure({ exitCode: 0 })).toBe("unknown");
    expect(classifyProviderFailure({})).toBe("unknown");
  });
});

describe("decideRetry", () => {
  it("escalates non-retryable auth failures without consuming the retry budget", () => {
    const decision = decideRetry({ attempt: 1, kind: "auth", maxAttempts: 3 });
    expect(decision).toEqual({
      attempt: 1,
      delayMs: 0,
      escalate: true,
      kind: "auth",
      retry: false,
    });
  });

  it("retries transient failures with exponential backoff capped at the policy ceiling", () => {
    expect(decideRetry({ attempt: 1, kind: "transient", maxAttempts: 4 }).delayMs).toBe(2_000);
    expect(decideRetry({ attempt: 2, kind: "transient", maxAttempts: 4 }).delayMs).toBe(4_000);
    expect(decideRetry({ attempt: 3, kind: "transient", maxAttempts: 4 }).delayMs).toBe(8_000);
  });

  it("backs off rate-limit failures much longer than transient ones", () => {
    const rateLimit = decideRetry({ attempt: 1, kind: "rate-limit", maxAttempts: 4 });
    const transient = decideRetry({ attempt: 1, kind: "transient", maxAttempts: 4 });
    expect(rateLimit.delayMs).toBeGreaterThan(transient.delayMs);
    expect(rateLimit.retry).toBe(true);
  });

  it("stops retrying once the attempt reaches the policy max attempts", () => {
    const decision = decideRetry({ attempt: 3, kind: "transient", maxAttempts: 3 });
    expect(decision.retry).toBe(false);
    expect(decision.escalate).toBe(false);
  });

  it("caps the backoff delay at the configured maximum", () => {
    const decision = decideRetry({ attempt: 20, kind: "rate-limit", maxAttempts: 100 });
    expect(decision.delayMs).toBe(defaultRetryPolicy().maxDelayMs);
  });

  it("applies a per-provider policy override", () => {
    const policies: ProviderRetryPolicies = {
      byProvider: { "claude-code": { nonRetryableKinds: ["auth", "rate-limit"] } },
    };
    const overridden = decideRetry({
      attempt: 1,
      kind: "rate-limit",
      maxAttempts: 3,
      policies,
      provider: "claude-code",
    });
    const baseline = decideRetry({ attempt: 1, kind: "rate-limit", maxAttempts: 3, policies });

    expect(overridden.escalate).toBe(true);
    expect(overridden.retry).toBe(false);
    expect(baseline.escalate).toBe(false);
    expect(baseline.retry).toBe(true);
  });
});
