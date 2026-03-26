import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentSemaphore } from "./concurrency.js";

// Mock createHaiAgent before importing TriageProcessor
vi.mock("./pi.js", () => ({
  createHaiAgent: vi.fn(),
}));

import { TriageProcessor, buildSpecificationPrompt } from "./triage.js";
import { createHaiAgent } from "./pi.js";
import type { TaskDetail } from "@hai/core";

const mockedCreateHaiAgent = vi.mocked(createHaiAgent);

function createMockStore(tasks: any[] = []) {
  return {
    listTasks: vi.fn().mockResolvedValue(tasks),
    getTask: vi.fn().mockResolvedValue({
      id: "HAI-001",
      title: "Test",
      description: "Test task",
      column: "triage",
      dependencies: [],
      steps: [],
      currentStep: 0,
      log: [],
      prompt: "# test",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    updateTask: vi.fn().mockResolvedValue({}),
    moveTask: vi.fn().mockResolvedValue({}),
    getSettings: vi.fn().mockResolvedValue({
      maxConcurrent: 2,
      maxWorktrees: 4,
      pollIntervalMs: 15000,
      groupOverlappingFiles: false,
      autoMerge: false,
    }),
  } as any;
}

function createMockTaskDetail(overrides: Partial<TaskDetail> = {}): TaskDetail {
  return {
    id: "HAI-001",
    title: "Test Task",
    description: "A test task",
    column: "triage",
    dependencies: [],
    steps: [],
    currentStep: 0,
    log: [],
    prompt: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("TriageProcessor with semaphore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("acquires semaphore before creating agent and releases after", async () => {
    const sem = new AgentSemaphore(1);
    const store = createMockStore();
    const acquireSpy = vi.spyOn(sem, "acquire");
    const releaseSpy = vi.spyOn(sem, "release");

    mockedCreateHaiAgent.mockResolvedValue({
      session: {
        prompt: vi.fn().mockResolvedValue(undefined),
        dispose: vi.fn(),
      },
    } as any);

    const triage = new TriageProcessor(store, "/tmp/test", { semaphore: sem });

    await triage.specifyTask({
      id: "HAI-001",
      title: "Test",
      description: "Test",
      column: "triage",
      dependencies: [],
      steps: [],
      currentStep: 0,
      log: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Semaphore was used via run() which calls acquire + release
    expect(acquireSpy).toHaveBeenCalledOnce();
    expect(releaseSpy).toHaveBeenCalledOnce();
    expect(mockedCreateHaiAgent).toHaveBeenCalledOnce();
    expect(sem.activeCount).toBe(0);
  });

  it("releases semaphore on agent error", async () => {
    const sem = new AgentSemaphore(1);
    const store = createMockStore();

    mockedCreateHaiAgent.mockRejectedValue(new Error("agent failed"));

    const onError = vi.fn();
    const triage = new TriageProcessor(store, "/tmp/test", {
      semaphore: sem,
      onSpecifyError: onError,
    });

    await triage.specifyTask({
      id: "HAI-001",
      title: "Test",
      description: "Test",
      column: "triage",
      dependencies: [],
      steps: [],
      currentStep: 0,
      log: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    expect(sem.activeCount).toBe(0);
    expect(onError).toHaveBeenCalled();
  });

  it("concurrent specifyTask calls respect semaphore limit", async () => {
    const sem = new AgentSemaphore(1);
    const store = createMockStore();
    let concurrent = 0;
    let maxConcurrent = 0;

    mockedCreateHaiAgent.mockImplementation(async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      return {
        session: {
          prompt: vi.fn().mockImplementation(async () => {
            await new Promise((r) => setTimeout(r, 10));
            concurrent--;
          }),
          dispose: vi.fn(),
        },
      } as any;
    });

    const triage = new TriageProcessor(store, "/tmp/test", { semaphore: sem });

    const task = (id: string) => ({
      id,
      title: "Test",
      description: "Test",
      column: "triage" as const,
      dependencies: [],
      steps: [],
      currentStep: 0,
      log: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await Promise.all([
      triage.specifyTask(task("HAI-001")),
      triage.specifyTask(task("HAI-002")),
      triage.specifyTask(task("HAI-003")),
    ]);

    expect(maxConcurrent).toBe(1);
    expect(sem.activeCount).toBe(0);
  });
});

describe("TriageProcessor dynamic poll interval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refreshes poll interval when settings.pollIntervalMs changes", async () => {
    const store = createMockStore();
    store.getSettings.mockResolvedValue({
      maxConcurrent: 2,
      maxWorktrees: 4,
      pollIntervalMs: 10000,
      groupOverlappingFiles: false,
      autoMerge: false,
    });

    const triage = new TriageProcessor(store, "/tmp/test");

    // Simulate start state
    (triage as any).running = true;
    (triage as any).activePollMs = 10000;
    (triage as any).pollInterval = setInterval(() => {}, 10000);

    // First poll — same interval, no change
    await (triage as any).poll();
    expect((triage as any).activePollMs).toBe(10000);

    // Change pollIntervalMs in settings
    store.getSettings.mockResolvedValue({
      maxConcurrent: 2,
      maxWorktrees: 4,
      pollIntervalMs: 3000,
      groupOverlappingFiles: false,
      autoMerge: false,
    });

    await (triage as any).poll();
    expect((triage as any).activePollMs).toBe(3000);

    // Clean up
    triage.stop();
  });
});

describe("buildSpecificationPrompt", () => {
  it("includes project commands when testCommand is set", () => {
    const task = createMockTaskDetail();
    const result = buildSpecificationPrompt(task, ".hai/tasks/HAI-001/PROMPT.md", {
      maxConcurrent: 2,
      maxWorktrees: 4,
      pollIntervalMs: 15000,
      groupOverlappingFiles: false,
      autoMerge: false,
      testCommand: "pnpm test",
    });

    expect(result).toContain("## Project Commands");
    expect(result).toContain("**Test:** `pnpm test`");
    expect(result).toContain("Use these exact commands");
  });

  it("includes project commands when buildCommand is set", () => {
    const task = createMockTaskDetail();
    const result = buildSpecificationPrompt(task, ".hai/tasks/HAI-001/PROMPT.md", {
      maxConcurrent: 2,
      maxWorktrees: 4,
      pollIntervalMs: 15000,
      groupOverlappingFiles: false,
      autoMerge: false,
      buildCommand: "pnpm build",
    });

    expect(result).toContain("## Project Commands");
    expect(result).toContain("**Build:** `pnpm build`");
  });

  it("includes both commands when both are set", () => {
    const task = createMockTaskDetail();
    const result = buildSpecificationPrompt(task, ".hai/tasks/HAI-001/PROMPT.md", {
      maxConcurrent: 2,
      maxWorktrees: 4,
      pollIntervalMs: 15000,
      groupOverlappingFiles: false,
      autoMerge: false,
      testCommand: "npm test",
      buildCommand: "npm run build",
    });

    expect(result).toContain("**Test:** `npm test`");
    expect(result).toContain("**Build:** `npm run build`");
  });

  it("omits project commands section when neither command is set", () => {
    const task = createMockTaskDetail();
    const result = buildSpecificationPrompt(task, ".hai/tasks/HAI-001/PROMPT.md", {
      maxConcurrent: 2,
      maxWorktrees: 4,
      pollIntervalMs: 15000,
      groupOverlappingFiles: false,
      autoMerge: false,
    });

    expect(result).not.toContain("## Project Commands");
  });

  it("omits project commands section when settings is undefined", () => {
    const task = createMockTaskDetail();
    const result = buildSpecificationPrompt(task, ".hai/tasks/HAI-001/PROMPT.md");

    expect(result).not.toContain("## Project Commands");
  });
});
