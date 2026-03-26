import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const workspaceRoot = join(import.meta.dirname!, "..", "..", "..", "..");

function loadWorkflow(name: string): any {
  const path = join(workspaceRoot, ".github", "workflows", name);
  const content = readFileSync(path, "utf-8");
  return { content, parsed: parse(content) };
}

describe("CI workflow (.github/workflows/ci.yml)", () => {
  let workflow: any;
  let content: string;

  beforeAll(() => {
    const result = loadWorkflow("ci.yml");
    workflow = result.parsed;
    content = result.content;
  });

  it("is valid YAML", () => {
    expect(workflow).toBeDefined();
    expect(typeof workflow).toBe("object");
  });

  it("has push trigger on main", () => {
    expect(workflow.on.push.branches).toContain("main");
  });

  it("has pull_request trigger on main", () => {
    expect(workflow.on.pull_request.branches).toContain("main");
  });

  it("includes pnpm install step", () => {
    expect(content).toContain("pnpm install");
  });

  it("includes pnpm build step", () => {
    expect(content).toContain("pnpm build");
  });

  it("includes pnpm build:exe step", () => {
    expect(content).toContain("pnpm build:exe");
  });

  it("includes pnpm test step", () => {
    expect(content).toContain("pnpm test");
  });
});

describe("Release workflow (.github/workflows/release.yml)", () => {
  let workflow: any;
  let content: string;

  beforeAll(() => {
    const result = loadWorkflow("release.yml");
    workflow = result.parsed;
    content = result.content;
  });

  it("is valid YAML", () => {
    expect(workflow).toBeDefined();
    expect(typeof workflow).toBe("object");
  });

  it("has tag-based trigger matching v*", () => {
    expect(workflow.on.push.tags).toBeDefined();
    const tags = workflow.on.push.tags;
    expect(tags.some((t: string) => t.includes("v"))).toBe(true);
  });

  it("includes softprops/action-gh-release action", () => {
    expect(content).toContain("softprops/action-gh-release");
  });

  it("includes permissions contents write", () => {
    expect(workflow.permissions?.contents).toBe("write");
  });

  it("includes pnpm install step", () => {
    expect(content).toContain("pnpm install");
  });

  it("includes pnpm build step", () => {
    expect(content).toContain("pnpm build");
  });

  it("includes pnpm build:exe step", () => {
    expect(content).toContain("pnpm build:exe");
  });

  it("generates SHA256 checksums", () => {
    expect(content).toContain("sha256sum");
  });
});

describe("Test Release workflow (.github/workflows/test-release.yml)", () => {
  let workflow: any;
  let content: string;

  beforeAll(() => {
    const result = loadWorkflow("test-release.yml");
    workflow = result.parsed;
    content = result.content;
  });

  it("is valid YAML", () => {
    expect(workflow).toBeDefined();
    expect(typeof workflow).toBe("object");
  });

  it("has workflow_dispatch trigger", () => {
    expect(workflow.on).toHaveProperty("workflow_dispatch");
  });

  it("includes pnpm install step", () => {
    expect(content).toContain("pnpm install");
  });

  it("includes pnpm build step", () => {
    expect(content).toContain("pnpm build");
  });

  it("includes pnpm build:exe step", () => {
    expect(content).toContain("pnpm build:exe");
  });

  it("includes smoke test with --help", () => {
    expect(content).toContain("--help");
  });

  it("uploads artifact", () => {
    expect(content).toContain("actions/upload-artifact");
  });
});
