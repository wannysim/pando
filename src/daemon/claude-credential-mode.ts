/**
 * Deterministic Claude worker credential-mode resolver for host vs Docker.
 *
 * W1/W6 finding (ADR-004 + handoff): Claude Code managed-connector auth does not
 * reliably inherit into a container, so a read-only host-file mount is only a
 * readiness signal — a live Docker Claude worker needs ANTHROPIC_API_KEY or a
 * container-local `claude /login` credential. This maps structured auth signals
 * (booleans only, never secret values) to a credential mode and live-runnability.
 */

export type ClaudeCredentialTarget = "host" | "docker";

export type ClaudeCredentialMode = "api-key" | "host-file" | "host-file-only" | "missing";

export interface ClaudeCredentialSignals {
  apiKeyPresent?: boolean;
  configDirPresent?: boolean;
  configFilePresent?: boolean;
  configFileNonEmpty?: boolean;
}

export interface ClaudeCredentialBlocker {
  reason: string;
  nextCommands: string[];
}

export interface ClaudeCredentialResolution {
  mode: ClaudeCredentialMode;
  liveRunnable: boolean;
  blocker?: ClaudeCredentialBlocker;
}

const API_KEY_NEXT_COMMANDS = [
  "export ANTHROPIC_API_KEY='<set locally; do not commit>' and pass -e ANTHROPIC_API_KEY to the Docker live smoke",
  "or run claude /login inside a persisted, untracked Docker auth volume and mount that volume",
];

export function resolveClaudeCredentialMode(
  signals: ClaudeCredentialSignals,
  target: ClaudeCredentialTarget,
): ClaudeCredentialResolution {
  if (signals.apiKeyPresent === true) {
    return { liveRunnable: true, mode: "api-key" };
  }

  const hostFileComplete =
    signals.configDirPresent === true &&
    signals.configFilePresent === true &&
    signals.configFileNonEmpty === true;

  if (hostFileComplete) {
    if (target === "host") {
      return { liveRunnable: true, mode: "host-file" };
    }
    return {
      blocker: {
        nextCommands: API_KEY_NEXT_COMMANDS,
        reason:
          "Claude host-file auth is only a readiness signal in Docker; the managed connector may not inherit into the container.",
      },
      liveRunnable: false,
      mode: "host-file-only",
    };
  }

  return {
    blocker: {
      nextCommands: API_KEY_NEXT_COMMANDS,
      reason: "Claude authentication is not configured (no API key or complete config file).",
    },
    liveRunnable: false,
    mode: "missing",
  };
}
