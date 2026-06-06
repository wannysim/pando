import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runBin(relativePath: string, args: readonly string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(repoRoot, relativePath), ...args], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

describe("bin wrappers", () => {
  it("bin/pando.mjs resolves the daemon bootstrap CLI", async () => {
    const result = await runBin("bin/pando.mjs", ["help"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("pando start");
  }, 30_000);

  it("bin/pandoctl.mjs resolves the operational CLI", async () => {
    const result = await runBin("bin/pandoctl.mjs", []);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("submit");
    expect(result.stderr).toContain("show <job-id>");
  }, 30_000);
});
