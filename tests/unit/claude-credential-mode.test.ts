import { describe, expect, it } from "bun:test";
import { resolveClaudeCredentialMode } from "../../src/daemon/claude-credential-mode";

describe("resolveClaudeCredentialMode", () => {
  it("treats an API key as live-runnable on host and docker", () => {
    expect(resolveClaudeCredentialMode({ apiKeyPresent: true }, "docker")).toEqual({
      liveRunnable: true,
      mode: "api-key",
    });
    expect(resolveClaudeCredentialMode({ apiKeyPresent: true }, "host")).toEqual({
      liveRunnable: true,
      mode: "api-key",
    });
  });

  it("treats a non-empty host config file as live-runnable on host", () => {
    expect(
      resolveClaudeCredentialMode(
        { configDirPresent: true, configFileNonEmpty: true, configFilePresent: true },
        "host",
      ),
    ).toEqual({ liveRunnable: true, mode: "host-file" });
  });

  it("flags docker host-file-only auth as not live-runnable with a credential blocker", () => {
    const resolution = resolveClaudeCredentialMode(
      { configDirPresent: true, configFileNonEmpty: true, configFilePresent: true },
      "docker",
    );

    expect(resolution.mode).toBe("host-file-only");
    expect(resolution.liveRunnable).toBe(false);
    expect(resolution.blocker?.reason).toMatch(/managed connector/i);
    expect(resolution.blocker?.nextCommands.some((cmd) => cmd.includes("ANTHROPIC_API_KEY"))).toBe(
      true,
    );
  });

  it("reports missing credentials when neither an API key nor a complete config file is present", () => {
    const resolution = resolveClaudeCredentialMode(
      { configDirPresent: true, configFileNonEmpty: false, configFilePresent: true },
      "host",
    );

    expect(resolution.mode).toBe("missing");
    expect(resolution.liveRunnable).toBe(false);
    expect(resolution.blocker?.nextCommands.length).toBeGreaterThan(0);
  });
});
