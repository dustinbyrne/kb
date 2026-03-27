import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, accessSync, constants } from "node:fs";
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

  it("includes build:exe step", () => {
    expect(content).toContain("build:exe");
  });

  it("generates SHA256 checksums", () => {
    expect(content).toContain("sha256sum");
  });

  describe("matrix build strategy", () => {
    it("has a build job with strategy.matrix including at least 4 entries", () => {
      const buildJob = workflow.jobs.build;
      expect(buildJob).toBeDefined();
      expect(buildJob.strategy?.matrix?.include?.length).toBeGreaterThanOrEqual(4);
    });

    it("includes all required OS runners", () => {
      const runners = workflow.jobs.build.strategy.matrix.include.map((e: any) => e.os);
      expect(runners).toContain("ubuntu-latest");
      expect(runners).toContain("macos-latest");
      expect(runners).toContain("macos-13");
      expect(runners).toContain("windows-latest");
    });

    it("includes all required Bun targets", () => {
      const targets = workflow.jobs.build.strategy.matrix.include.map((e: any) => e.target);
      expect(targets).toContain("bun-linux-x64");
      expect(targets).toContain("bun-darwin-arm64");
      expect(targets).toContain("bun-darwin-x64");
      expect(targets).toContain("bun-windows-x64");
    });

    it("has a release job that needs the build job", () => {
      const releaseJob = workflow.jobs.release;
      expect(releaseJob).toBeDefined();
      const needs = Array.isArray(releaseJob.needs) ? releaseJob.needs : [releaseJob.needs];
      expect(needs).toContain("build");
    });

    it("generates checksums on all platforms", () => {
      expect(content).toContain("sha256sum");
      expect(content).toContain("shasum -a 256");
      expect(content).toContain("Get-FileHash");
    });
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

  it("includes build:exe step", () => {
    expect(content).toContain("build:exe");
  });

  it("includes smoke test with --help", () => {
    expect(content).toContain("--help");
  });

  it("uploads artifact", () => {
    expect(content).toContain("actions/upload-artifact");
  });

  describe("matrix build strategy", () => {
    it("has a build job with strategy.matrix including at least 4 entries", () => {
      const buildJob = workflow.jobs.build;
      expect(buildJob).toBeDefined();
      expect(buildJob.strategy?.matrix?.include?.length).toBeGreaterThanOrEqual(4);
    });

    it("includes all required OS runners", () => {
      const runners = workflow.jobs.build.strategy.matrix.include.map((e: any) => e.os);
      expect(runners).toContain("ubuntu-latest");
      expect(runners).toContain("macos-latest");
      expect(runners).toContain("macos-13");
      expect(runners).toContain("windows-latest");
    });

    it("includes all required Bun targets", () => {
      const targets = workflow.jobs.build.strategy.matrix.include.map((e: any) => e.target);
      expect(targets).toContain("bun-linux-x64");
      expect(targets).toContain("bun-darwin-arm64");
      expect(targets).toContain("bun-darwin-x64");
      expect(targets).toContain("bun-windows-x64");
    });

    it("generates checksums on all platforms", () => {
      expect(content).toContain("sha256sum");
      expect(content).toContain("shasum -a 256");
      expect(content).toContain("Get-FileHash");
    });
  });
});

describe("Code signing — Release workflow", () => {
  let content: string;

  beforeAll(() => {
    const result = loadWorkflow("release.yml");
    content = result.content;
  });

  it("contains macOS signing step referencing sign-macos.sh", () => {
    expect(content).toContain("sign-macos.sh");
  });

  it("contains Windows signing step referencing sign-windows.ps1", () => {
    expect(content).toContain("sign-windows.ps1");
  });

  it("macOS signing step is conditioned on runner.os", () => {
    expect(content).toMatch(/if:.*runner\.os\s*==\s*'macOS'/);
  });

  it("Windows signing step is conditioned on runner.os", () => {
    expect(content).toMatch(/if:.*runner\.os\s*==\s*'Windows'/);
  });

  it("references all required Apple secrets", () => {
    const requiredSecrets = [
      "APPLE_CERTIFICATE_BASE64",
      "APPLE_CERTIFICATE_PASSWORD",
      "APPLE_ID",
      "APPLE_TEAM_ID",
      "APPLE_APP_PASSWORD",
    ];
    for (const secret of requiredSecrets) {
      expect(content).toContain(`secrets.${secret}`);
    }
  });

  it("references Windows signing secrets", () => {
    expect(content).toContain("secrets.WINDOWS_CERTIFICATE_BASE64");
    expect(content).toContain("secrets.WINDOWS_CERTIFICATE_PASSWORD");
  });

  it("checksums step comes after signing steps", () => {
    const signMacosIndex = content.indexOf("sign-macos.sh");
    const signWindowsIndex = content.indexOf("sign-windows.ps1");
    const checksumIndex = content.indexOf("Generate checksum");
    expect(signMacosIndex).toBeLessThan(checksumIndex);
    expect(signWindowsIndex).toBeLessThan(checksumIndex);
  });
});

describe("Code signing — Test-release workflow", () => {
  let content: string;

  beforeAll(() => {
    const result = loadWorkflow("test-release.yml");
    content = result.content;
  });

  it("has macOS signing step with secret-availability guard", () => {
    expect(content).toContain("sign-macos.sh");
    expect(content).toMatch(/if:.*APPLE_CERTIFICATE_BASE64\s*!=\s*''/);
  });

  it("has Windows signing step with secret-availability guard", () => {
    expect(content).toContain("sign-windows.ps1");
    expect(content).toMatch(/if:.*WINDOWS_CERTIFICATE_BASE64\s*!=\s*''/);
  });
});

describe("Code signing — Scripts", () => {
  const scriptsDir = join(workspaceRoot, "scripts");

  it("sign-macos.sh exists and is executable", () => {
    const scriptPath = join(scriptsDir, "sign-macos.sh");
    expect(() => accessSync(scriptPath, constants.F_OK)).not.toThrow();
    expect(() => accessSync(scriptPath, constants.X_OK)).not.toThrow();
  });

  it("sign-windows.ps1 exists", () => {
    const scriptPath = join(scriptsDir, "sign-windows.ps1");
    expect(() => accessSync(scriptPath, constants.F_OK)).not.toThrow();
  });

  it("sign-macos.sh references codesign, notarytool, and security import", () => {
    const script = readFileSync(join(scriptsDir, "sign-macos.sh"), "utf-8");
    expect(script).toContain("codesign");
    expect(script).toContain("notarytool");
    expect(script).toContain("security import");
  });

  it("sign-windows.ps1 references signtool", () => {
    const script = readFileSync(join(scriptsDir, "sign-windows.ps1"), "utf-8");
    expect(script).toContain("signtool");
  });
});
