import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { worktreePoolLog } from "./logger.js";

/**
 * A pool of idle git worktrees that can be recycled across tasks.
 *
 * When `recycleWorktrees` is enabled, completed task worktrees are returned
 * to this pool instead of being deleted. New tasks acquire a warm worktree
 * from the pool, preserving build caches (node_modules, target/, dist/).
 *
 * The pool only tracks *idle* worktrees — those not currently assigned to
 * any active task. The scheduler's `maxWorktrees` setting still governs
 * the total number of worktrees (active + idle).
 */
export class WorktreePool {
  private idle = new Set<string>();

  /**
   * Acquire an idle worktree from the pool.
   *
   * Returns the absolute path of an idle worktree, or `null` if the pool
   * is empty. Before returning, verifies the directory still exists on disk
   * and prunes any stale entries.
   */
  acquire(): string | null {
    for (const path of this.idle) {
      this.idle.delete(path);
      if (existsSync(path)) {
        return path;
      }
      worktreePoolLog.log(`Pruned stale entry: ${path}`);
    }
    return null;
  }

  /**
   * Return a worktree to the idle pool after a task completes.
   *
   * The worktree directory is retained on disk with its build caches intact.
   * Call this instead of `git worktree remove` when recycling is enabled.
   *
   * @param worktreePath — Absolute path to the worktree directory
   */
  release(worktreePath: string): void {
    this.idle.add(worktreePath);
  }

  /** Number of idle worktrees currently in the pool. */
  get size(): number {
    return this.idle.size;
  }

  /** Check whether a specific path is in the idle pool. */
  has(path: string): boolean {
    return this.idle.has(path);
  }

  /**
   * Remove and return all idle worktree paths.
   *
   * Useful for shutdown/cleanup — the caller is responsible for
   * running `git worktree remove` on each returned path.
   */
  drain(): string[] {
    const paths = Array.from(this.idle);
    this.idle.clear();
    return paths;
  }

  /**
   * Prepare a recycled worktree for a new task.
   *
   * Resets the working tree to a clean state, then creates (or force-resets)
   * the task's branch based on `main`. This ensures the new task starts
   * from the latest main with a clean working directory, while preserving
   * untracked build caches (node_modules, target/, dist/).
   *
   * Steps performed:
   * 1. `git checkout -- .` — discard tracked file modifications
   * 2. `git clean -fd` — remove untracked files (but not .gitignore'd caches)
   * 3. `git checkout -B <branchName> main` — create/reset branch from main
   *
   * @param worktreePath — Absolute path to the recycled worktree
   * @param branchName — Branch name for the new task (e.g., `kb/kb-042`)
   */
  prepareForTask(worktreePath: string, branchName: string): void {
    // Clean tracked modifications
    try {
      execSync("git checkout -- .", { cwd: worktreePath, stdio: "pipe" });
    } catch {
      // May fail if worktree is already clean — that's fine
    }

    // Remove untracked files (but not .gitignore'd build caches)
    execSync("git clean -fd", { cwd: worktreePath, stdio: "pipe" });

    // Create or force-reset the branch from main
    execSync(`git checkout -B "${branchName}" main`, {
      cwd: worktreePath,
      stdio: "pipe",
    });
  }
}
