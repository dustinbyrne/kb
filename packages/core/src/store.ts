import { EventEmitter } from "node:events";
import { execSync } from "node:child_process";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { Task, TaskDetail, TaskCreateInput, BoardConfig, Column, MergeResult } from "./types.js";
import { VALID_TRANSITIONS } from "./types.js";

export interface TaskStoreEvents {
  "task:created": [task: Task];
  "task:moved": [data: { task: Task; from: Column; to: Column }];
  "task:updated": [task: Task];
  "task:deleted": [task: Task];
  "task:merged": [result: MergeResult];
}

export class TaskStore extends EventEmitter<TaskStoreEvents> {
  private haiDir: string;
  private tasksDir: string;
  private configPath: string;

  constructor(private rootDir: string) {
    super();
    this.haiDir = join(rootDir, ".hai");
    this.tasksDir = join(this.haiDir, "tasks");
    this.configPath = join(this.haiDir, "config.json");
  }

  async init(): Promise<void> {
    await mkdir(this.tasksDir, { recursive: true });
    if (!existsSync(this.configPath)) {
      await this.writeConfig({ nextId: 1 });
    }
  }

  private async readConfig(): Promise<BoardConfig> {
    const data = await readFile(this.configPath, "utf-8");
    return JSON.parse(data);
  }

  private async writeConfig(config: BoardConfig): Promise<void> {
    await writeFile(this.configPath, JSON.stringify(config, null, 2));
  }

  private async allocateId(): Promise<string> {
    const config = await this.readConfig();
    const id = `HAI-${String(config.nextId).padStart(3, "0")}`;
    config.nextId++;
    await this.writeConfig(config);
    return id;
  }

  private taskDir(id: string): string {
    return join(this.tasksDir, id);
  }

  async createTask(input: TaskCreateInput): Promise<Task> {
    const id = await this.allocateId();
    const now = new Date().toISOString();
    const task: Task = {
      id,
      title: input.title,
      description: input.description || "",
      column: input.column || "triage",
      dependencies: input.dependencies || [],
      createdAt: now,
      updatedAt: now,
    };

    const dir = this.taskDir(id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "task.json"), JSON.stringify(task, null, 2));

    const prompt = task.column === "triage"
      ? `# ${id}: ${task.title}\n\n${task.description}\n`
      : this.generateSpecifiedPrompt(task);
    await writeFile(join(dir, "PROMPT.md"), prompt);

    this.emit("task:created", task);
    return task;
  }

  async getTask(id: string): Promise<TaskDetail> {
    const dir = this.taskDir(id);
    const data = await readFile(join(dir, "task.json"), "utf-8");
    const task = JSON.parse(data) as Task;

    let prompt = "";
    const promptPath = join(dir, "PROMPT.md");
    if (existsSync(promptPath)) {
      prompt = await readFile(promptPath, "utf-8");
    }

    return { ...task, prompt };
  }

  async listTasks(): Promise<Task[]> {
    if (!existsSync(this.tasksDir)) return [];

    const entries = await readdir(this.tasksDir, { withFileTypes: true });
    const tasks: Task[] = [];

    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith("HAI-")) {
        try {
          const data = await readFile(
            join(this.tasksDir, entry.name, "task.json"),
            "utf-8",
          );
          tasks.push(JSON.parse(data));
        } catch {
          // skip invalid task dirs
        }
      }
    }

    return tasks.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async moveTask(id: string, toColumn: Column): Promise<Task> {
    const dir = this.taskDir(id);
    const data = await readFile(join(dir, "task.json"), "utf-8");
    const task = JSON.parse(data) as Task;

    const validTargets = VALID_TRANSITIONS[task.column];
    if (!validTargets.includes(toColumn)) {
      throw new Error(
        `Invalid transition: '${task.column}' → '${toColumn}'. ` +
          `Valid targets: ${validTargets.join(", ") || "none"}`,
      );
    }

    const fromColumn = task.column;
    task.column = toColumn;
    task.updatedAt = new Date().toISOString();

    await writeFile(join(dir, "task.json"), JSON.stringify(task, null, 2));

    this.emit("task:moved", { task, from: fromColumn, to: toColumn });
    return task;
  }

  async updateTask(
    id: string,
    updates: { title?: string; description?: string; prompt?: string; worktree?: string },
  ): Promise<Task> {
    const dir = this.taskDir(id);
    const data = await readFile(join(dir, "task.json"), "utf-8");
    const task = JSON.parse(data) as Task;

    if (updates.title !== undefined) task.title = updates.title;
    if (updates.description !== undefined) task.description = updates.description;
    if (updates.worktree !== undefined) task.worktree = updates.worktree;
    task.updatedAt = new Date().toISOString();

    await writeFile(join(dir, "task.json"), JSON.stringify(task, null, 2));

    if (updates.prompt !== undefined) {
      await writeFile(join(dir, "PROMPT.md"), updates.prompt);
    }

    this.emit("task:updated", task);
    return task;
  }

  async deleteTask(id: string): Promise<Task> {
    const dir = this.taskDir(id);
    const data = await readFile(join(dir, "task.json"), "utf-8");
    const task = JSON.parse(data) as Task;

    const { rm } = await import("node:fs/promises");
    await rm(dir, { recursive: true });

    this.emit("task:deleted", task);
    return task;
  }

  /**
   * Merge an in-review task's branch into the current branch,
   * clean up the worktree, and move the task to done.
   */
  async mergeTask(id: string): Promise<MergeResult> {
    const dir = this.taskDir(id);
    const data = await readFile(join(dir, "task.json"), "utf-8");
    const task = JSON.parse(data) as Task;

    if (task.column !== "in-review") {
      throw new Error(
        `Cannot merge ${id}: task is in '${task.column}', must be in 'in-review'`,
      );
    }

    const branch = `hai/${id.toLowerCase()}`;
    const worktreePath = task.worktree || join(this.rootDir, ".worktrees", id);
    const result: MergeResult = {
      task,
      branch,
      merged: false,
      worktreeRemoved: false,
      branchDeleted: false,
    };

    // 1. Check the branch exists
    try {
      execSync(`git rev-parse --verify "${branch}"`, {
        cwd: this.rootDir,
        stdio: "pipe",
      });
    } catch {
      // No branch — might have been manually merged. Just move to done.
      result.error = `Branch '${branch}' not found — moving to done without merge`;
      await this.moveToDone(task, dir);
      result.task = { ...task, column: "done" };
      this.emit("task:merged", result);
      return result;
    }

    // 2. Merge the branch
    try {
      execSync(`git merge "${branch}" --no-edit`, {
        cwd: this.rootDir,
        stdio: "pipe",
      });
      result.merged = true;
    } catch (err: any) {
      // Merge conflict — abort and report
      try {
        execSync("git merge --abort", { cwd: this.rootDir, stdio: "pipe" });
      } catch {
        // already clean
      }
      throw new Error(
        `Merge conflict merging '${branch}'. Resolve manually:\n` +
          `  cd ${this.rootDir}\n` +
          `  git merge ${branch}\n` +
          `  # resolve conflicts, then: hai task move ${id} done`,
      );
    }

    // 3. Remove worktree
    if (existsSync(worktreePath)) {
      try {
        execSync(`git worktree remove "${worktreePath}" --force`, {
          cwd: this.rootDir,
          stdio: "pipe",
        });
        result.worktreeRemoved = true;
      } catch {
        // Non-fatal — worktree may already be gone
      }
    }

    // 4. Delete the branch
    try {
      execSync(`git branch -d "${branch}"`, {
        cwd: this.rootDir,
        stdio: "pipe",
      });
      result.branchDeleted = true;
    } catch {
      // Branch might not be fully merged in some edge cases; try force
      try {
        execSync(`git branch -D "${branch}"`, {
          cwd: this.rootDir,
          stdio: "pipe",
        });
        result.branchDeleted = true;
      } catch {
        // Non-fatal
      }
    }

    // 5. Move task to done
    await this.moveToDone(task, dir);
    result.task = { ...task, column: "done" };

    this.emit("task:merged", result);
    return result;
  }

  private async moveToDone(task: Task, dir: string): Promise<void> {
    task.column = "done";
    task.worktree = undefined;
    task.updatedAt = new Date().toISOString();
    await writeFile(join(dir, "task.json"), JSON.stringify(task, null, 2));
    this.emit("task:moved", { task, from: "in-review" as Column, to: "done" as Column });
  }

  getRootDir(): string {
    return this.rootDir;
  }

  private generateSpecifiedPrompt(task: Task): string {
    const deps =
      task.dependencies.length > 0
        ? task.dependencies.map((d) => `- **Task:** ${d}`).join("\n")
        : "- **None**";

    return `# ${task.id}: ${task.title}

**Created:** ${task.createdAt.split("T")[0]}
**Size:** M

## Mission

${task.description || task.title}

## Dependencies

${deps}

## Steps

### Step 1: Implementation

- [ ] Implement the required changes
- [ ] Verify changes work correctly

### Step 2: Testing & Verification

- [ ] All tests pass
- [ ] No regressions introduced

### Step 3: Documentation & Delivery

- [ ] Update relevant documentation
- [ ] .DONE created

## Acceptance Criteria

- [ ] All steps complete
- [ ] All tests passing
`;
  }
}
