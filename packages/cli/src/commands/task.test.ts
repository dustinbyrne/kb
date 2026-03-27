import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock @kb/core before importing the module under test
vi.mock("@kb/core", () => {
  const COLUMNS = ["triage", "specified", "in-progress", "review", "done"];
  const COLUMN_LABELS: Record<string, string> = {
    triage: "Triage",
    specified: "Specified",
    "in-progress": "In Progress",
    review: "Review",
    done: "Done",
  };

  return {
    TaskStore: vi.fn(),
    COLUMNS,
    COLUMN_LABELS,
  };
});

// Mock @kb/engine
vi.mock("@kb/engine", () => ({ aiMergeTask: vi.fn() }));

import { TaskStore } from "@kb/core";
import { runTaskShow, runTaskCreate } from "./task.js";

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "KB-001",
    description: "A short description",
    column: "triage",
    dependencies: [],
    steps: [],
    currentStep: 0,
    log: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("runTaskShow", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("displays the full description without truncation when no title", async () => {
    const longDesc = "A".repeat(120); // well over 60 chars
    const task = makeTask({ description: longDesc });

    (TaskStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      init: vi.fn(),
      getTask: vi.fn().mockResolvedValue(task),
    }));

    await runTaskShow("KB-001");

    const headerLine = logSpy.mock.calls.find(
      (call) => typeof call[0] === "string" && call[0].includes("KB-001:")
    );
    expect(headerLine).toBeDefined();
    expect(headerLine![0]).toContain(longDesc);
    // Ensure no truncation happened
    expect(headerLine![0]).not.toContain(longDesc.slice(0, 60) + "…");
    expect(headerLine![0].length).toBeGreaterThan(60 + "  KB-001: ".length);
  });

  it("displays the title when present instead of description", async () => {
    const task = makeTask({
      title: "My Task Title",
      description: "This is the full description that should not appear in the header",
    });

    (TaskStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      init: vi.fn(),
      getTask: vi.fn().mockResolvedValue(task),
    }));

    await runTaskShow("KB-001");

    const headerLine = logSpy.mock.calls.find(
      (call) => typeof call[0] === "string" && call[0].includes("KB-001:")
    );
    expect(headerLine).toBeDefined();
    expect(headerLine![0]).toContain("My Task Title");
    expect(headerLine![0]).not.toContain("This is the full description");
  });
});

// Mock fs/promises for runTaskCreate attach tests
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

describe("runTaskCreate with --attach", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let mockAddAttachment: ReturnType<typeof vi.fn>;
  let mockReadFile: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    mockAddAttachment = vi.fn().mockResolvedValue({
      filename: "abc123-test.png",
      originalName: "test.png",
      mimeType: "image/png",
      size: 2048,
      createdAt: new Date().toISOString(),
    });

    (TaskStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      init: vi.fn(),
      createTask: vi.fn().mockResolvedValue({
        id: "KB-002",
        description: "test task",
        column: "triage",
        dependencies: [],
        steps: [],
        currentStep: 0,
        log: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      addAttachment: mockAddAttachment,
    }));

    const fsMod = await import("node:fs/promises");
    mockReadFile = vi.mocked(fsMod.readFile);
    mockReadFile.mockResolvedValue(Buffer.from("file content"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates task and attaches files when attachFiles provided", async () => {
    await runTaskCreate("test task", ["/tmp/test.png"]);

    expect(mockAddAttachment).toHaveBeenCalledOnce();
    expect(mockAddAttachment).toHaveBeenCalledWith(
      "KB-002",
      "test.png",
      expect.any(Buffer),
      "image/png",
    );

    const attachLine = logSpy.mock.calls.find(
      (call) => typeof call[0] === "string" && call[0].includes("Attached"),
    );
    expect(attachLine).toBeDefined();
  });

  it("attaches multiple files", async () => {
    mockAddAttachment.mockResolvedValueOnce({
      filename: "abc-screenshot.png",
      originalName: "screenshot.png",
      mimeType: "image/png",
      size: 1024,
      createdAt: new Date().toISOString(),
    }).mockResolvedValueOnce({
      filename: "def-crash.log",
      originalName: "crash.log",
      mimeType: "text/plain",
      size: 512,
      createdAt: new Date().toISOString(),
    });

    await runTaskCreate("test task", ["/tmp/screenshot.png", "/tmp/crash.log"]);

    expect(mockAddAttachment).toHaveBeenCalledTimes(2);
  });

  it("skips files with unsupported extensions", async () => {
    await runTaskCreate("test task", ["/tmp/file.exe"]);

    expect(mockAddAttachment).not.toHaveBeenCalled();
    const errLine = errorSpy.mock.calls.find(
      (call) => typeof call[0] === "string" && call[0].includes("Unsupported"),
    );
    expect(errLine).toBeDefined();
  });

  it("skips unreadable files", async () => {
    mockReadFile.mockRejectedValueOnce(new Error("ENOENT"));

    await runTaskCreate("test task", ["/tmp/missing.png"]);

    expect(mockAddAttachment).not.toHaveBeenCalled();
    const errLine = errorSpy.mock.calls.find(
      (call) => typeof call[0] === "string" && call[0].includes("Cannot read"),
    );
    expect(errLine).toBeDefined();
  });

  it("creates task without attachments when attachFiles is undefined", async () => {
    await runTaskCreate("test task");

    expect(mockAddAttachment).not.toHaveBeenCalled();
  });
});
