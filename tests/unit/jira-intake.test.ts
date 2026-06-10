import { describe, expect, it } from "bun:test";
import { buildJiraWorkItem } from "../../src/intake/jira";

describe("buildJiraWorkItem", () => {
  it("maps the ticket fixVersion onto the WorkItem jira payload", () => {
    const item = buildJiraWorkItem({
      fixVersion: "1.0",
      repo: "web",
      ticketKey: "DEMO-1234",
      title: "Ship the thing",
    });

    expect(item).toEqual({
      id: "DEMO-1234",
      payload: { fixVersion: "1.0", kind: "jira", ticketKey: "DEMO-1234" },
      repo: "web",
      source: "jira",
      title: "Ship the thing",
    });
  });

  it("defaults the title to the ticket key when none is given", () => {
    const item = buildJiraWorkItem({ repo: "web", ticketKey: "DEMO-1234" });

    expect(item.title).toBe("DEMO-1234");
    expect(item.payload).toEqual({ kind: "jira", ticketKey: "DEMO-1234" });
  });

  it("carries optional branch, baseBranch override, and dependsOn", () => {
    const item = buildJiraWorkItem({
      baseBranch: "release/9.9",
      branch: "feat/demo",
      dependsOn: ["DEMO-1"],
      repo: "web",
      ticketKey: "DEMO-1234",
    });

    expect(item.baseBranch).toBe("release/9.9");
    expect(item.branch).toBe("feat/demo");
    expect(item.dependsOn).toEqual(["DEMO-1"]);
  });

  it("omits a blank fixVersion from the payload", () => {
    const item = buildJiraWorkItem({ fixVersion: "   ", repo: "web", ticketKey: "DEMO-1234" });

    expect(item.payload).toEqual({ kind: "jira", ticketKey: "DEMO-1234" });
  });
});
