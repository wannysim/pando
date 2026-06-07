import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(new URL(".", import.meta.url).pathname, "../..");

async function readDoc(relPath: string): Promise<string> {
  return readFile(resolve(root, relPath), "utf8");
}

describe("current status docs", () => {
  it("states inline brief intake is available in both READMEs", async () => {
    const readme = await readDoc("README.md");
    const koreanReadme = await readDoc("README.ko.md");

    expect(readme).toMatch(/inline.*brief|natural-language.*brief/is);
    expect(koreanReadme).toMatch(/인라인.*brief|자연어.*brief/is);
    expect(readme).not.toContain("brief intake is still file-path based");
    expect(koreanReadme).not.toContain("brief 입력은 아직 파일 경로 기반");
  });

  it("marks roadmap PR 7 through PR 10 done and points the next step at W6", async () => {
    const roadmap = await readDoc("docs/practical-adoption-roadmap.md");

    expect(roadmap).toContain("### Done: PR 7 — one-command local run");
    expect(roadmap).toContain("### Done: PR 8 — web inline brief intake");
    expect(roadmap).toContain("### Done: PR 9 — Docker worker readiness hardening");
    expect(roadmap).toContain("### Done: PR 10 — pandoctl npm distribution");
    expect(roadmap).toContain("다음 작업은 **W6 운영 확장**");
    expect(roadmap).not.toContain("다음 작업은 **PR 10: pandoctl npm distribution**");
  });

  it("handoff marks PR10 done and names W6 as the next step", async () => {
    const handoff = await readDoc("docs/handoff.md");

    expect(handoff).toContain("PR #52");
    expect(handoff).toContain("PR #53");
    expect(handoff).toContain("PR #54");
    expect(handoff).toContain("PR #55");
    expect(handoff).toContain("✅ **pandoctl npm distribution** (roadmap PR 10)");
    expect(handoff).toContain("다음은 **W6 운영 확장**");
    expect(handoff).not.toContain(
      "남은 roadmap 항목은 **pandoctl npm distribution(PR 10)** 하나다",
    );
  });

  it("next-session prompt points at W6 rather than PR10", async () => {
    const prompt = await readDoc("docs/next-session-prompt.md");

    expect(prompt).toContain("W6 운영 확장");
    expect(prompt).not.toContain("다음 세션 목표는 PR 10: pandoctl npm distribution");
  });

  it("two-job smoke runbook no longer says production server daemon wiring is absent", async () => {
    const runbook = await readDoc("docs/runbooks/two-job-smoke.md");

    expect(runbook).not.toContain(
      "Production `src/server.ts` still serves API/static dashboard only",
    );
    expect(runbook).toContain("Docker live worker smoke");
  });
});
