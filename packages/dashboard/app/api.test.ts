import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchTaskDetail } from "./api";
import type { TaskDetail } from "@hai/core";

const FAKE_DETAIL: TaskDetail = {
  id: "HAI-001",
  description: "Test",
  column: "in-progress",
  dependencies: [],
  steps: [],
  currentStep: 0,
  log: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  prompt: "# HAI-001",
};

function mockFetchResponse(ok: boolean, body: unknown, status = ok ? 200 : 500) {
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

describe("fetchTaskDetail", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it("returns data on first success", async () => {
    globalThis.fetch = vi.fn().mockReturnValue(mockFetchResponse(true, FAKE_DETAIL));

    const result = await fetchTaskDetail("HAI-001");

    expect(result.id).toBe("HAI-001");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("retries once on failure then succeeds", async () => {
    globalThis.fetch = vi.fn()
      .mockReturnValueOnce(mockFetchResponse(false, { error: "Transient error" }))
      .mockReturnValueOnce(mockFetchResponse(true, FAKE_DETAIL));

    const result = await fetchTaskDetail("HAI-001");

    expect(result.id).toBe("HAI-001");
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("throws after retry exhaustion", async () => {
    globalThis.fetch = vi.fn()
      .mockReturnValue(mockFetchResponse(false, { error: "Server error" }));

    await expect(fetchTaskDetail("HAI-001")).rejects.toThrow("Server error");
    expect(globalThis.fetch).toHaveBeenCalledTimes(2); // initial + 1 retry
  });
});
