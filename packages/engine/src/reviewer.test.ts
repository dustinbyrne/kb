import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./pi.js", () => ({
  createHaiAgent: vi.fn(),
}));

import { reviewStep } from "./reviewer.js";
import { createHaiAgent } from "./pi.js";

const mockedCreateHaiAgent = vi.mocked(createHaiAgent);

function createMockSession(reviewText: string) {
  return {
    session: {
      prompt: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockImplementation((cb: any) => {
        // Simulate the reviewer producing text
        cb({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: reviewText },
        });
      }),
      dispose: vi.fn(),
    },
  } as any;
}

describe("reviewStep — model settings threading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes defaultProvider and defaultModelId to createHaiAgent when provided", async () => {
    mockedCreateHaiAgent.mockResolvedValue(
      createMockSession("### Verdict: APPROVE\n### Summary\nLooks good."),
    );

    await reviewStep(
      "/tmp/worktree", "HAI-100", 1, "Test Step", "plan", "# prompt",
      undefined,
      {
        defaultProvider: "anthropic",
        defaultModelId: "claude-sonnet-4-5",
      },
    );

    expect(mockedCreateHaiAgent).toHaveBeenCalledTimes(1);
    const opts = mockedCreateHaiAgent.mock.calls[0][0];
    expect(opts.defaultProvider).toBe("anthropic");
    expect(opts.defaultModelId).toBe("claude-sonnet-4-5");
  });

  it("does not set model fields when ReviewOptions omits them", async () => {
    mockedCreateHaiAgent.mockResolvedValue(
      createMockSession("### Verdict: APPROVE\n### Summary\nAll good."),
    );

    await reviewStep(
      "/tmp/worktree", "HAI-100", 1, "Test Step", "plan", "# prompt",
      undefined,
      {},
    );

    expect(mockedCreateHaiAgent).toHaveBeenCalledTimes(1);
    const opts = mockedCreateHaiAgent.mock.calls[0][0];
    expect(opts.defaultProvider).toBeUndefined();
    expect(opts.defaultModelId).toBeUndefined();
  });

  it("extracts APPROVE verdict correctly", async () => {
    mockedCreateHaiAgent.mockResolvedValue(
      createMockSession("### Verdict: APPROVE\n### Summary\nLooks good."),
    );

    const result = await reviewStep(
      "/tmp/worktree", "HAI-100", 1, "Test Step", "plan", "# prompt",
    );

    expect(result.verdict).toBe("APPROVE");
  });
});
