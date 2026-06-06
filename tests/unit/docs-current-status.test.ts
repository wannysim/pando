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

  it("marks roadmap PR 7 through PR 9 done and leaves PR 10 as the next milestone", async () => {
    const roadmap = await readDoc("docs/practical-adoption-roadmap.md");

    expect(roadmap).toContain("### Done: PR 7 — one-command local run");
    expect(roadmap).toContain("### Done: PR 8 — web inline brief intake");
    expect(roadmap).toContain("### Done: PR 9 — Docker worker readiness hardening");
    expect(roadmap).toContain("다음 작업은 **PR 10: pandoctl npm distribution**");
    expect(roadmap).not.toContain("다음 작업은 **PR 7: one-command local run**");
  });

  it("handoff says PR10 is the only remaining roadmap item", async () => {
    const handoff = await readDoc("docs/handoff.md");

    expect(handoff).toContain("PR #52");
    expect(handoff).toContain("PR #53");
    expect(handoff).toContain("PR #54");
    expect(handoff).toContain("PR #55");
    expect(handoff).toContain("남은 roadmap 항목은 **pandoctl npm distribution(PR 10)**");
    expect(handoff).not.toContain("Release branch routing** — Jira `fixVersion` 기반");
    expect(handoff).not.toContain(
      "Gate adapter 연결** — checksum/diff/workspace scoping의 순수 계약은 완료됐지만",
    );
  });

  it("next-session prompt points at PR10 rather than productization follow-ups", async () => {
    const prompt = await readDoc("docs/next-session-prompt.md");

    expect(prompt).toContain("다음 세션 목표는 PR 10: pandoctl npm distribution");
    expect(prompt).not.toContain("one-command local run, web inline brief intake");
  });

  it("two-job smoke runbook no longer says production server daemon wiring is absent", async () => {
    const runbook = await readDoc("docs/runbooks/two-job-smoke.md");

    expect(runbook).not.toContain(
      "Production `src/server.ts` still serves API/static dashboard only",
    );
    expect(runbook).toContain("Docker live worker smoke");
  });
});
