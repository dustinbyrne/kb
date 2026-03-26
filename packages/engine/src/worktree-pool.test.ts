import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(true),
}));

import { WorktreePool } from "./worktree-pool.js";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

const mockedExecSync = vi.mocked(execSync);
const mockedExistsSync = vi.mocked(existsSync);

describe("WorktreePool", () => {
  let pool: WorktreePool;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedExistsSync.mockReturnValue(true);
    pool = new WorktreePool();
  });

  describe("acquire", () => {
    it("returns null when pool is empty", () => {
      expect(pool.acquire()).toBeNull();
    });

    it("returns a released path on acquire", () => {
      pool.release("/tmp/worktree-1");
      const result = pool.acquire();
      expect(result).toBe("/tmp/worktree-1");
    });

    it("prunes entries where directory no longer exists on disk", () => {
      pool.release("/tmp/stale-worktree");
      pool.release("/tmp/good-worktree");
      // First path doesn't exist, second does
      mockedExistsSync.mockImplementation((p) => p === "/tmp/good-worktree");

      const result = pool.acquire();
      expect(result).toBe("/tmp/good-worktree");
      expect(pool.size).toBe(0);
    });

    it("returns null when all entries are stale", () => {
      pool.release("/tmp/stale-1");
      pool.release("/tmp/stale-2");
      mockedExistsSync.mockReturnValue(false);

      expect(pool.acquire()).toBeNull();
      expect(pool.size).toBe(0);
    });
  });

  describe("release", () => {
    it("adds a path to the pool", () => {
      pool.release("/tmp/wt-1");
      expect(pool.size).toBe(1);
      expect(pool.has("/tmp/wt-1")).toBe(true);
    });

    it("does not duplicate on double release", () => {
      pool.release("/tmp/wt-1");
      pool.release("/tmp/wt-1");
      expect(pool.size).toBe(1);
    });
  });

  describe("size", () => {
    it("reflects correct count after operations", () => {
      expect(pool.size).toBe(0);
      pool.release("/tmp/a");
      pool.release("/tmp/b");
      expect(pool.size).toBe(2);
      pool.acquire();
      expect(pool.size).toBe(1);
      pool.acquire();
      expect(pool.size).toBe(0);
    });
  });

  describe("has", () => {
    it("returns false for unknown paths", () => {
      expect(pool.has("/tmp/unknown")).toBe(false);
    });

    it("returns true for released paths", () => {
      pool.release("/tmp/wt");
      expect(pool.has("/tmp/wt")).toBe(true);
    });

    it("returns false after path is acquired", () => {
      pool.release("/tmp/wt");
      pool.acquire();
      expect(pool.has("/tmp/wt")).toBe(false);
    });
  });

  describe("drain", () => {
    it("empties the pool and returns all paths", () => {
      pool.release("/tmp/a");
      pool.release("/tmp/b");
      pool.release("/tmp/c");
      const paths = pool.drain();
      expect(paths).toHaveLength(3);
      expect(paths).toContain("/tmp/a");
      expect(paths).toContain("/tmp/b");
      expect(paths).toContain("/tmp/c");
      expect(pool.size).toBe(0);
    });

    it("returns empty array when pool is empty", () => {
      expect(pool.drain()).toEqual([]);
    });
  });

  describe("prepareForTask", () => {
    it("cleans dirty working tree before checkout", () => {
      pool.prepareForTask("/tmp/wt", "hai/hai-042");

      const calls = mockedExecSync.mock.calls.map((c) => c[0]);
      expect(calls).toContain("git checkout -- .");
      expect(calls).toContain("git clean -fd");
    });

    it("creates branch from main with force-reset", () => {
      pool.prepareForTask("/tmp/wt", "hai/hai-042");

      const checkoutCall = mockedExecSync.mock.calls.find(
        (c) => typeof c[0] === "string" && (c[0] as string).includes("checkout -B"),
      );
      expect(checkoutCall).toBeDefined();
      expect(checkoutCall![0]).toBe('git checkout -B "hai/hai-042" main');
      expect(checkoutCall![1]).toMatchObject({ cwd: "/tmp/wt" });
    });

    it("runs all commands in the correct worktree directory", () => {
      pool.prepareForTask("/tmp/my-worktree", "hai/hai-099");

      for (const call of mockedExecSync.mock.calls) {
        expect(call[1]).toMatchObject({ cwd: "/tmp/my-worktree" });
      }
    });

    it("tolerates git checkout -- . failure (already clean)", () => {
      mockedExecSync.mockImplementation((cmd: any) => {
        if (cmd === "git checkout -- .") throw new Error("nothing to checkout");
        return Buffer.from("");
      });

      // Should not throw
      expect(() => pool.prepareForTask("/tmp/wt", "hai/hai-001")).not.toThrow();

      // Should still run clean and branch creation
      const calls = mockedExecSync.mock.calls.map((c) => c[0]);
      expect(calls).toContain("git clean -fd");
      expect(calls).toContain('git checkout -B "hai/hai-001" main');
    });
  });
});
