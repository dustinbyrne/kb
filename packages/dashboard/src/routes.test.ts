import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import http from "node:http";
import { createApiRoutes } from "./routes.js";
import type { TaskStore } from "@hai/core";
import type { TaskDetail } from "@hai/core";

function createMockStore(overrides: Partial<TaskStore> = {}): TaskStore {
  return {
    getTask: vi.fn(),
    listTasks: vi.fn().mockResolvedValue([]),
    createTask: vi.fn(),
    moveTask: vi.fn(),
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
    mergeTask: vi.fn(),
    getSettings: vi.fn().mockResolvedValue({}),
    updateSettings: vi.fn(),
    ...overrides,
  } as unknown as TaskStore;
}

const FAKE_TASK_DETAIL: TaskDetail = {
  id: "HAI-001",
  description: "Test task",
  column: "in-progress",
  dependencies: [],
  steps: [],
  currentStep: 0,
  log: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  prompt: "# HAI-001\n\nTest task",
};

/** Helper: send GET and return { status, body } */
async function GET(app: express.Express, path: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address() as { port: number };
      http.get(`http://127.0.0.1:${addr.port}${path}`, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          server.close();
          try {
            resolve({ status: res.statusCode!, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode!, body: data });
          }
        });
      }).on("error", (err) => { server.close(); reject(err); });
    });
  });
}

describe("GET /tasks/:id", () => {
  let store: TaskStore;

  beforeEach(() => {
    store = createMockStore();
  });

  function buildApp() {
    const app = express();
    app.use(express.json());
    app.use("/api", createApiRoutes(store));
    return app;
  }

  it("returns task detail on success", async () => {
    (store.getTask as ReturnType<typeof vi.fn>).mockResolvedValue(FAKE_TASK_DETAIL);

    const res = await GET(buildApp(), "/api/tasks/HAI-001");

    expect(res.status).toBe(200);
    expect(res.body.id).toBe("HAI-001");
    expect(res.body.prompt).toBe("# HAI-001\n\nTest task");
  });

  it("returns 404 when task genuinely does not exist (ENOENT)", async () => {
    const err: NodeJS.ErrnoException = new Error("ENOENT: no such file or directory");
    err.code = "ENOENT";
    (store.getTask as ReturnType<typeof vi.fn>).mockRejectedValue(err);

    const res = await GET(buildApp(), "/api/tasks/HAI-999");

    expect(res.status).toBe(404);
    expect(res.body.error).toContain("not found");
  });

  it("returns 500 on transient/unexpected errors (non-ENOENT)", async () => {
    const err = new Error("Unexpected end of JSON input");
    (store.getTask as ReturnType<typeof vi.fn>).mockRejectedValue(err);

    const res = await GET(buildApp(), "/api/tasks/HAI-001");

    expect(res.status).toBe(500);
    expect(res.body.error).toContain("Unexpected end of JSON input");
  });
});
