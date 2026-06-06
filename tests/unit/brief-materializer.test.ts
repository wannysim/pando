import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createFsBriefWriter,
  materializeInlineBrief,
  type BriefWriter,
} from "../../src/intake/brief-materializer";

function recordingWriter(): BriefWriter & { writes: Array<{ path: string; content: string }> } {
  const writes: Array<{ path: string; content: string }> = [];
  return {
    writes,
    async writeBrief(path, content) {
      writes.push({ content, path });
    },
  };
}

describe("inline brief materializer", () => {
  it("composes, validates, and writes a canonical brief.md under the inbox", async () => {
    const writer = recordingWriter();

    const result = await materializeInlineBrief({
      id: "footer-year",
      inboxRoot: "/tmp/pando-inbox",
      brief: {
        title: "Make the footer year dynamic",
        goal: "Keep the copyright year correct without manual edits.",
        userStory: "As a visitor, I want the footer to show the current year.",
        acceptanceCriteria: ["The footer renders the current year."],
        screensOrBehavior: "Footer reads the current year at render time.",
        nonGoals: ["Do not redesign the footer."],
        assets: ["src/footer.tsx"],
        openQuestions: [],
      },
      writer,
    });

    expect(result.briefPath).toBe("/tmp/pando-inbox/footer-year/brief.md");
    expect(result.assets).toEqual(["src/footer.tsx"]);
    expect(writer.writes).toHaveLength(1);
    expect(writer.writes[0]?.path).toBe("/tmp/pando-inbox/footer-year/brief.md");
    expect(writer.writes[0]?.content).toContain("# Make the footer year dynamic");
    expect(writer.writes[0]?.content).toContain("- src/footer.tsx");
  });

  it("rejects schema-invalid inline briefs without writing", async () => {
    const writer = recordingWriter();

    await expect(
      materializeInlineBrief({
        id: "no-title",
        inboxRoot: "/tmp/pando-inbox",
        brief: { title: "", body: "do something" },
        writer,
      }),
    ).rejects.toThrow(/brief schema validation failed/i);
    expect(writer.writes).toEqual([]);
  });

  it("returns undefined assets when no references are given", async () => {
    const writer = recordingWriter();

    const result = await materializeInlineBrief({
      id: "min",
      inboxRoot: "/tmp/pando-inbox",
      brief: {
        title: "Minimal brief",
        body: "A minimal change.",
        acceptanceCriteria: ["It is verifiable."],
      },
      writer,
    });

    expect(result.assets).toBeUndefined();
  });
});

describe("fs brief writer", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
  });

  it("creates parent directories and writes the brief through real fs", async () => {
    const inboxRoot = await mkdtemp(join(tmpdir(), "pando-inbox-"));
    dirs.push(inboxRoot);

    const result = await materializeInlineBrief({
      id: "real-fs",
      inboxRoot,
      brief: {
        title: "Real fs brief",
        body: "Write a real file.",
        acceptanceCriteria: ["The file exists on disk."],
      },
      writer: createFsBriefWriter(),
    });

    const written = await readFile(result.briefPath, "utf8");
    expect(written).toContain("# Real fs brief");
  });
});
