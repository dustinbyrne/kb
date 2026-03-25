import { EventEmitter } from "node:events";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { Task, TaskDetail, TaskCreateInput, BoardConfig, Column } from "./types.js";
import { VALID_TRANSITIONS } from "./types.js";

export interface TaskStoreEvents {
  "task:created": [task: Task];
  "task:moved": [data: { task: Task; from: Column; to: Column }];
  "task:updated": [task: Task];
  "task:deleted": [task: Task];
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
    updates: { title?: string; description?: string; prompt?: string },
  ): Promise<Task> {
    const dir = this.taskDir(id);
    const data = await readFile(join(dir, "task.json"), "utf-8");
    const task = JSON.parse(data) as Task;

    if (updates.title !== undefined) task.title = updates.title;
    if (updates.description !== undefined) task.description = updates.description;
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
