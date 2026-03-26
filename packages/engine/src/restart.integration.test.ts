/**
 * Integration tests for engine restart resilience.
 *
 * Verifies that after an engine crash/restart:
 * - In-progress tasks resume from their current step (not from scratch)
 * - Existing worktrees are reused rather than recreated
 * - Step progress survives and is communicated to the agent
 * - In-review tasks get re-queued for merge
 * - Triage re-picks unspecified tasks
 * - Crash scenarios are handled gracefully (semaphore release, status cleanup)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentSemaphore } from "./concurrency.js";

// ── Module-level mocks (matching existing test patterns) ──────────────────

vi.mock("./pi.js", () => ({
  createHaiAgent: vi.fn(),
}));
vi.mock("./reviewer.js", () => ({
  reviewStep: vi.fn(),
}));
vi.mock("node:child_process", () => ({
  execSync: vi.fn().mockReturnValue(Buffer.from("")),
}));
vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(true),
}));

import { TaskExecutor } from "./executor.js";
import { TriageProcessor } from "./triage.js";
import { Scheduler } from "./scheduler.js";
import { aiMergeTask } from "./merger.js";
import { createHaiAgent } from "./pi.js";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { Task, TaskDetail, TaskStep, Column, Settings, StepStatus } from "@hai/core";

const mockedCreateHaiAgent = vi.mocked(createHaiAgent);
const mockedExecSync = vi.mocked(execSync);
const mockedExistsSync = vi.mocked(existsSync);

// ── Mock helpers ──────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: Settings = {
  maxConcurrent: 2,
  maxWorktrees: 4,
  pollIntervalMs: 15000,
  groupOverlappingFiles: false,
  autoMerge: false,
  worktreeInitCommand: undefined,
};

function createMockStore(overrides: Record<string, any> = {}) {
  const listeners = new Map<string, Function[]>();
  return {
    on: vi.fn((event: string, fn: Function) => {
      const existing = listeners.get(event) || [];
      existing.push(fn);
      listeners.set(event, existing);
    }),
    emit: vi.fn(),
    listTasks: vi.fn().mockResolvedValue([]),
    getTask: vi.fn().mockResolvedValue(makeTaskDetail("HAI-001", "in-progress")),
    updateTask: vi.fn().mockResolvedValue({}),
    moveTask: vi.fn().mockImplementation(async (id: string, col: Column) => {
      return makeTask(id, col);
    }),
    logEntry: vi.fn().mockResolvedValue(undefined),
    parseStepsFromPrompt: vi.fn().mockResolvedValue([]),
    parseFileScopeFromPrompt: vi.fn().mockResolvedValue([]),
    getSettings: vi.fn().mockResolvedValue({ ...DEFAULT_SETTINGS }),
    updateStep: vi.fn().mockImplementation(async (id: string, step: number, status: StepStatus) => {
      return makeTaskDetail(id, "in-progress");
    }),
    createTask: vi.fn().mockImplementation(async (input: any) => {
      return makeTask("HAI-NEW", "triage");
    }),
    deleteTask: vi.fn().mockResolvedValue(undefined),
    _listeners: listeners,
    ...overrides,
  } as any;
}

function makeTask(id: string, column: Column, overrides: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    description: `Description for ${id}`,
    column,
    dependencies: [],
    steps: [],
    currentStep: 0,
    log: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeTaskDetail(id: string, column: Column, overrides: Partial<TaskDetail> = {}): TaskDetail {
  return {
    ...makeTask(id, column, overrides),
    prompt: overrides.prompt ?? "# test\n## Steps\n### Step 0: Preflight\n- [ ] check\n## Review Level: 0",
    ...overrides,
  };
}

function makeSteps(...statuses: StepStatus[]): TaskStep[] {
  return statuses.map((status, i) => ({
    name: `Step ${i}`,
    status,
  }));
}

function mockAgentSuccess() {
  mockedCreateHaiAgent.mockResolvedValue({
    session: {
      prompt: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(),
    },
  } as any);
}

function mockAgentFailure(error = "agent crashed") {
  mockedCreateHaiAgent.mockRejectedValue(new Error(error));
}

// ── Tests begin ───────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockedExistsSync.mockReturnValue(true); // Default: worktrees exist (resume scenario)
  mockedExecSync.mockReturnValue(Buffer.from(""));
});

// ── Step 2: In-progress task resume tests ─────────────────────────────────

describe("In-progress task resume after restart", () => {
  it("resumeOrphaned() calls execute() for each in-progress task not already executing", async () => {
    const store = createMockStore();
    const task1 = makeTask("HAI-001", "in-progress");
    const task2 = makeTask("HAI-002", "in-progress");
    const taskDone = makeTask("HAI-003", "done");
    store.listTasks.mockResolvedValue([task1, task2, taskDone]);

    mockAgentSuccess();

    const executor = new TaskExecutor(store, "/tmp/test");
    await executor.resumeOrphaned();

    // Wait for async execute calls to complete
    await new Promise((r) => setTimeout(r, 50));

    // createHaiAgent should have been called once per in-progress task
    expect(mockedCreateHaiAgent).toHaveBeenCalledTimes(2);
  });

  it("resumed task reuses existing worktree — no git worktree add called", async () => {
    const store = createMockStore();
    const task = makeTask("HAI-010", "in-progress", {
      worktree: "/tmp/wt/HAI-010",
    });
    store.listTasks.mockResolvedValue([task]);
    store.getTask.mockResolvedValue(makeTaskDetail("HAI-010", "in-progress", {
      worktree: "/tmp/wt/HAI-010",
    }));

    // Worktree exists on disk
    mockedExistsSync.mockReturnValue(true);
    mockAgentSuccess();

    const executor = new TaskExecutor(store, "/tmp/test");
    await executor.resumeOrphaned();
    await new Promise((r) => setTimeout(r, 50));

    // No git worktree add commands should have been called
    const gitWorktreeAddCalls = mockedExecSync.mock.calls.filter(
      (call) => typeof call[0] === "string" && call[0].includes("git worktree add"),
    );
    expect(gitWorktreeAddCalls).toHaveLength(0);
  });

  it("resumed task with step progress includes RESUMING section in agent prompt", async () => {
    const store = createMockStore();
    const steps = makeSteps("done", "done", "done", "in-progress", "pending");
    const task = makeTask("HAI-020", "in-progress", { steps, currentStep: 3 });
    store.listTasks.mockResolvedValue([task]);
    store.getTask.mockResolvedValue(makeTaskDetail("HAI-020", "in-progress", {
      steps,
      currentStep: 3,
    }));

    let capturedPrompt = "";
    mockedCreateHaiAgent.mockResolvedValue({
      session: {
        prompt: vi.fn().mockImplementation(async (prompt: string) => {
          capturedPrompt = prompt;
        }),
        dispose: vi.fn(),
      },
    } as any);

    const executor = new TaskExecutor(store, "/tmp/test");
    await executor.resumeOrphaned();
    await new Promise((r) => setTimeout(r, 50));

    expect(capturedPrompt).toContain("⚠️ RESUMING");
    expect(capturedPrompt).toContain("Step 0 (Step 0): **done**");
    expect(capturedPrompt).toContain("Step 3 (Step 3): **in-progress**");
    expect(capturedPrompt).toContain("Resume from: Step 3");
  });

  it("resumed task does NOT re-run worktreeInitCommand", async () => {
    const store = createMockStore();
    store.getSettings.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      worktreeInitCommand: "pnpm install",
    });
    const task = makeTask("HAI-030", "in-progress");
    store.listTasks.mockResolvedValue([task]);
    store.getTask.mockResolvedValue(makeTaskDetail("HAI-030", "in-progress"));

    mockedExistsSync.mockReturnValue(true); // worktree exists
    mockAgentSuccess();

    const executor = new TaskExecutor(store, "/tmp/test");
    await executor.resumeOrphaned();
    await new Promise((r) => setTimeout(r, 50));

    // getSettings should NOT have been called (skipped entire !isResume block)
    expect(store.getSettings).not.toHaveBeenCalled();

    // No init command calls
    const initCalls = mockedExecSync.mock.calls.filter(
      (call) => call[0] === "pnpm install",
    );
    expect(initCalls).toHaveLength(0);
  });

  it("resumeOrphaned() logs 'Resumed after engine restart' for each orphaned task", async () => {
    const store = createMockStore();
    const task1 = makeTask("HAI-040", "in-progress");
    const task2 = makeTask("HAI-041", "in-progress");
    store.listTasks.mockResolvedValue([task1, task2]);
    store.getTask.mockImplementation(async (id: string) =>
      makeTaskDetail(id, "in-progress"),
    );

    mockAgentSuccess();

    const executor = new TaskExecutor(store, "/tmp/test");
    await executor.resumeOrphaned();
    await new Promise((r) => setTimeout(r, 50));

    expect(store.logEntry).toHaveBeenCalledWith("HAI-040", "Resumed after engine restart");
    expect(store.logEntry).toHaveBeenCalledWith("HAI-041", "Resumed after engine restart");
  });
});

// ── Step 3: In-review merge re-queue tests ────────────────────────────────
//
// The merge queue/enqueueMerge logic lives in dashboard.ts (CLI layer).
// These tests focus on what @hai/engine owns: aiMergeTask() behaviour
// relevant to restart resilience — state validation, status lifecycle,
// and error handling with git reset --merge cleanup.

describe("In-review merge handling after restart", () => {
  it("aiMergeTask validates task is in 'in-review' before merging", async () => {
    const store = createMockStore();
    store.getTask.mockResolvedValue(makeTaskDetail("HAI-050", "in-progress"));

    await expect(aiMergeTask(store, "/tmp/root", "HAI-050")).rejects.toThrow(
      "Cannot merge HAI-050: task is in 'in-progress', must be in 'in-review'",
    );

    // No git commands should have been executed
    expect(mockedExecSync).not.toHaveBeenCalled();
  });

  it("aiMergeTask sets status to 'merging' during execution and clears on success", async () => {
    const store = createMockStore();
    store.getTask.mockResolvedValue(makeTaskDetail("HAI-051", "in-review"));
    store.moveTask.mockResolvedValue(makeTask("HAI-051", "done"));

    // Branch exists, merge succeeds, no conflicts
    mockedExecSync.mockImplementation((cmd: any) => {
      // git diff --cached --quiet check: return "0" (clean)
      if (typeof cmd === "string" && cmd.includes("git diff --cached")) {
        return "0" as any;
      }
      return Buffer.from("");
    });

    mockAgentSuccess();

    await aiMergeTask(store, "/tmp/root", "HAI-051");

    // Should have set status to "merging"
    expect(store.updateTask).toHaveBeenCalledWith("HAI-051", { status: "merging" });
    // Should have cleared status via completeTask (status: null before moveTask)
    expect(store.updateTask).toHaveBeenCalledWith("HAI-051", { status: null });
  });

  it("sequential aiMergeTask calls for multiple in-review tasks all succeed", async () => {
    const taskIds = ["HAI-052", "HAI-053", "HAI-054"];

    for (const taskId of taskIds) {
      const store = createMockStore();
      store.getTask.mockResolvedValue(makeTaskDetail(taskId, "in-review"));
      store.moveTask.mockResolvedValue(makeTask(taskId, "done"));

      mockedExecSync.mockImplementation((cmd: any) => {
        if (typeof cmd === "string" && cmd.includes("git diff --cached")) {
          return "0" as any;
        }
        return Buffer.from("");
      });
      mockAgentSuccess();

      const result = await aiMergeTask(store, "/tmp/root", taskId);
      expect(result.merged).toBe(true);
      expect(store.moveTask).toHaveBeenCalledWith(taskId, "done");
    }
  });

  it("aiMergeTask throws on agent failure during session.prompt and calls git reset --merge", async () => {
    const store = createMockStore();
    store.getTask.mockResolvedValue(makeTaskDetail("HAI-055", "in-review"));

    // Branch exists, merge starts, agent creates but prompt fails
    mockedExecSync.mockImplementation((cmd: any) => {
      if (typeof cmd === "string" && cmd.includes("git diff --cached")) {
        return "0" as any;
      }
      return Buffer.from("");
    });

    mockedCreateHaiAgent.mockResolvedValue({
      session: {
        prompt: vi.fn().mockRejectedValue(new Error("merge agent crashed")),
        dispose: vi.fn(),
      },
    } as any);

    await expect(aiMergeTask(store, "/tmp/root", "HAI-055")).rejects.toThrow(
      "AI merge failed for HAI-055: merge agent crashed",
    );

    // Should have attempted git reset --merge cleanup
    const resetCalls = mockedExecSync.mock.calls.filter(
      (call) => typeof call[0] === "string" && call[0].includes("git reset --merge"),
    );
    expect(resetCalls.length).toBeGreaterThan(0);

    // Status was set to "merging" but NOT cleared by aiMergeTask (that's the dashboard's job)
    expect(store.updateTask).toHaveBeenCalledWith("HAI-055", { status: "merging" });
  });

  it("aiMergeTask moves task to done when branch does not exist", async () => {
    const store = createMockStore();
    store.getTask.mockResolvedValue(makeTaskDetail("HAI-056", "in-review"));
    store.moveTask.mockResolvedValue(makeTask("HAI-056", "done"));

    // git rev-parse --verify throws (branch not found)
    mockedExecSync.mockImplementation((cmd: any) => {
      if (typeof cmd === "string" && cmd.includes("git rev-parse --verify")) {
        throw new Error("branch not found");
      }
      return Buffer.from("");
    });

    const result = await aiMergeTask(store, "/tmp/root", "HAI-056");

    expect(result.merged).toBe(false);
    expect(result.error).toContain("Branch");
    expect(store.moveTask).toHaveBeenCalledWith("HAI-056", "done");
  });
});

// ── Step 4: Triage re-pick and scheduler tests ────────────────────────────

describe("Triage re-pick after restart", () => {
  it("TriageProcessor.start() after restart picks up triage tasks (processing set is fresh)", async () => {
    const store = createMockStore();
    const triageTask1 = makeTask("HAI-060", "triage");
    const triageTask2 = makeTask("HAI-061", "triage");
    store.listTasks.mockResolvedValue([triageTask1, triageTask2]);
    store.getTask.mockImplementation(async (id: string) =>
      makeTaskDetail(id, "triage"),
    );

    mockAgentSuccess();

    const triage = new TriageProcessor(store, "/tmp/root", {
      pollIntervalMs: 100000, // large interval to avoid re-poll
    });
    triage.start();

    // Wait for the immediate poll() to fire
    await new Promise((r) => setTimeout(r, 100));
    triage.stop();

    // Both triage tasks should have been picked up for specification
    expect(store.updateTask).toHaveBeenCalledWith("HAI-060", { status: "specifying" });
    expect(store.updateTask).toHaveBeenCalledWith("HAI-061", { status: "specifying" });
    expect(mockedCreateHaiAgent).toHaveBeenCalledTimes(2);
  });

  it("specifyTask() skips task already in processing set (no double-specification)", async () => {
    const store = createMockStore();
    const task = makeTask("HAI-062", "triage");
    store.getTask.mockResolvedValue(makeTaskDetail("HAI-062", "triage"));

    // Slow agent to keep task in processing
    let resolvePrompt: Function;
    mockedCreateHaiAgent.mockResolvedValue({
      session: {
        prompt: vi.fn().mockImplementation(() => new Promise((r) => { resolvePrompt = r; })),
        dispose: vi.fn(),
      },
    } as any);

    const triage = new TriageProcessor(store, "/tmp/root");

    // Start first specification (will block on prompt)
    const first = triage.specifyTask(task);

    // Give it time to enter processing set
    await new Promise((r) => setTimeout(r, 20));

    // Second call should be a no-op (already processing)
    await triage.specifyTask(task);

    // Only one agent created
    expect(mockedCreateHaiAgent).toHaveBeenCalledTimes(1);

    // Resolve the blocked prompt to clean up
    resolvePrompt!();
    await first;
  });
});

describe("Scheduler after restart", () => {
  it("schedule() moves todo tasks to in-progress when deps are satisfied", async () => {
    const store = createMockStore();
    const todoTask = makeTask("HAI-070", "todo");
    store.listTasks.mockResolvedValue([todoTask]);
    store.getSettings.mockResolvedValue({ ...DEFAULT_SETTINGS });

    // Needs parseFileScopeFromPrompt for overlap checks
    store.parseFileScopeFromPrompt.mockResolvedValue([]);

    const onSchedule = vi.fn();
    const scheduler = new Scheduler(store, {
      maxConcurrent: 2,
      maxWorktrees: 4,
      onSchedule,
    });

    // Use start/stop to trigger schedule() then clean up
    scheduler.start();
    await new Promise((r) => setTimeout(r, 50));
    scheduler.stop();

    expect(store.moveTask).toHaveBeenCalledWith("HAI-070", "in-progress");
    expect(store.updateTask).toHaveBeenCalledWith("HAI-070", { status: null });
    expect(onSchedule).toHaveBeenCalledWith(todoTask);
  });

  it("schedule() respects dependency ordering — blocked tasks stay in todo", async () => {
    const store = createMockStore();
    const depTask = makeTask("HAI-071", "in-progress");
    const blockedTask = makeTask("HAI-072", "todo", {
      dependencies: ["HAI-071"],
    });
    store.listTasks.mockResolvedValue([depTask, blockedTask]);
    store.getSettings.mockResolvedValue({ ...DEFAULT_SETTINGS });

    const onBlocked = vi.fn();
    const scheduler = new Scheduler(store, {
      maxConcurrent: 2,
      maxWorktrees: 4,
      onBlocked,
    });

    scheduler.start();
    await new Promise((r) => setTimeout(r, 50));
    scheduler.stop();

    // Task should NOT have been moved
    expect(store.moveTask).not.toHaveBeenCalledWith("HAI-072", "in-progress");
    expect(onBlocked).toHaveBeenCalledWith(blockedTask, ["HAI-071"]);
  });

  it("full column coverage: restart with tasks in every column", async () => {
    const store = createMockStore();

    // Tasks across all columns
    const triageTask = makeTask("HAI-080", "triage");
    const todoTask = makeTask("HAI-081", "todo");
    const inProgressTask = makeTask("HAI-082", "in-progress");
    const inReviewTask = makeTask("HAI-083", "in-review");
    const doneTask = makeTask("HAI-084", "done");

    const allTasks = [triageTask, todoTask, inProgressTask, inReviewTask, doneTask];
    store.listTasks.mockResolvedValue(allTasks);
    store.getTask.mockImplementation(async (id: string) => {
      const t = allTasks.find((t) => t.id === id)!;
      return makeTaskDetail(id, t.column);
    });
    store.getSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, autoMerge: true });

    mockAgentSuccess();

    // 1. Triage picks up triage tasks
    const triage = new TriageProcessor(store, "/tmp/root", {
      pollIntervalMs: 100000,
    });
    triage.start();
    await new Promise((r) => setTimeout(r, 100));
    triage.stop();

    expect(store.updateTask).toHaveBeenCalledWith("HAI-080", { status: "specifying" });

    // 2. Scheduler moves todo → in-progress
    vi.clearAllMocks();
    store.listTasks.mockResolvedValue(allTasks);
    store.getSettings.mockResolvedValue({ ...DEFAULT_SETTINGS });

    const scheduler = new Scheduler(store, { maxConcurrent: 2, maxWorktrees: 4 });
    scheduler.start();
    await new Promise((r) => setTimeout(r, 50));
    scheduler.stop();

    expect(store.moveTask).toHaveBeenCalledWith("HAI-081", "in-progress");

    // 3. Executor resumes in-progress tasks
    vi.clearAllMocks();
    store.listTasks.mockResolvedValue(allTasks);
    store.getTask.mockImplementation(async (id: string) => {
      const t = allTasks.find((t) => t.id === id)!;
      return makeTaskDetail(id, t.column);
    });
    mockAgentSuccess();

    const executor = new TaskExecutor(store, "/tmp/root");
    await executor.resumeOrphaned();
    await new Promise((r) => setTimeout(r, 50));

    expect(store.logEntry).toHaveBeenCalledWith("HAI-082", "Resumed after engine restart");

    // 4. Done tasks are untouched (no operations on HAI-084)
    const doneCalls = [
      ...store.updateTask.mock.calls,
      ...store.moveTask.mock.calls,
    ].filter((call) => call[0] === "HAI-084");
    expect(doneCalls).toHaveLength(0);
  });
});

// ── Step 5: Crash scenario edge case tests ────────────────────────────────

describe("Crash scenario edge cases", () => {
  it("agent dies mid-step — onError is called, semaphore slot released, task eligible for resume", async () => {
    const sem = new AgentSemaphore(2);
    const store = createMockStore();
    const task = makeTask("HAI-090", "in-progress");
    store.listTasks.mockResolvedValue([task]);
    store.getTask.mockResolvedValue(makeTaskDetail("HAI-090", "in-progress"));

    // Agent session.prompt rejects (simulating crash mid-step)
    mockedCreateHaiAgent.mockResolvedValue({
      session: {
        prompt: vi.fn().mockRejectedValue(new Error("agent died mid-step")),
        dispose: vi.fn(),
      },
    } as any);

    const onError = vi.fn();
    const executor = new TaskExecutor(store, "/tmp/test", {
      semaphore: sem,
      onError,
    });

    await executor.resumeOrphaned();
    await new Promise((r) => setTimeout(r, 50));

    // onError should have been called
    expect(onError).toHaveBeenCalledWith(task, expect.any(Error));

    // Semaphore slot should be released
    expect(sem.activeCount).toBe(0);

    // Task should be eligible for resume (not in executing set)
    // Verify by calling resumeOrphaned again — it should try to execute again
    vi.clearAllMocks();
    store.listTasks.mockResolvedValue([task]);
    store.getTask.mockResolvedValue(makeTaskDetail("HAI-090", "in-progress"));
    mockAgentSuccess();

    await executor.resumeOrphaned();
    await new Promise((r) => setTimeout(r, 50));

    // Agent should have been created again for the re-resume
    expect(mockedCreateHaiAgent).toHaveBeenCalledTimes(1);
  });

  it("engine killed during merge — git reset --merge cleanup, task stays in-review", async () => {
    const store = createMockStore();
    store.getTask.mockResolvedValue(makeTaskDetail("HAI-091", "in-review"));

    mockedExecSync.mockReturnValue(Buffer.from(""));

    // Agent prompt rejects (simulating kill during merge)
    mockedCreateHaiAgent.mockResolvedValue({
      session: {
        prompt: vi.fn().mockRejectedValue(new Error("killed")),
        dispose: vi.fn(),
      },
    } as any);

    await expect(aiMergeTask(store, "/tmp/root", "HAI-091")).rejects.toThrow();

    // git reset --merge should have been called
    const resetCalls = mockedExecSync.mock.calls.filter(
      (call) => typeof call[0] === "string" && call[0].includes("git reset --merge"),
    );
    expect(resetCalls.length).toBeGreaterThan(0);

    // Task should NOT have been moved to done
    expect(store.moveTask).not.toHaveBeenCalledWith("HAI-091", "done");

    // Status was set to "merging" during execution
    expect(store.updateTask).toHaveBeenCalledWith("HAI-091", { status: "merging" });
  });

  it("concurrent resumeOrphaned() calls don't double-execute the same task", async () => {
    const store = createMockStore();
    const task = makeTask("HAI-092", "in-progress");
    store.listTasks.mockResolvedValue([task]);
    store.getTask.mockResolvedValue(makeTaskDetail("HAI-092", "in-progress"));

    let resolvePrompt: Function;
    mockedCreateHaiAgent.mockResolvedValue({
      session: {
        prompt: vi.fn().mockImplementation(() => new Promise((r) => { resolvePrompt = r; })),
        dispose: vi.fn(),
      },
    } as any);

    const executor = new TaskExecutor(store, "/tmp/test");

    // First call starts execution
    const first = executor.resumeOrphaned();
    await new Promise((r) => setTimeout(r, 20));

    // Second call while first is still executing
    const second = executor.resumeOrphaned();
    await new Promise((r) => setTimeout(r, 20));

    // Only one agent should have been created (the executing set guards against double-exec)
    expect(mockedCreateHaiAgent).toHaveBeenCalledTimes(1);

    // Clean up
    resolvePrompt!();
    await first;
    await second;
  });

  it("semaphore integrity after crash — activeCount returns to pre-execution value", async () => {
    const sem = new AgentSemaphore(3);
    const store = createMockStore();

    // Pre-acquire one slot to simulate other work
    await sem.acquire();
    expect(sem.activeCount).toBe(1);

    const task = makeTask("HAI-093", "in-progress");
    store.listTasks.mockResolvedValue([task]);
    store.getTask.mockResolvedValue(makeTaskDetail("HAI-093", "in-progress"));

    // Agent creation itself fails
    mockedCreateHaiAgent.mockRejectedValue(new Error("cannot create agent"));

    const onError = vi.fn();
    const executor = new TaskExecutor(store, "/tmp/test", {
      semaphore: sem,
      onError,
    });

    await executor.resumeOrphaned();
    await new Promise((r) => setTimeout(r, 50));

    // Semaphore should return to pre-execution count (1 from our manual acquire)
    expect(sem.activeCount).toBe(1);
    expect(onError).toHaveBeenCalled();

    // Release our manual slot
    sem.release();
    expect(sem.activeCount).toBe(0);
  });
});
