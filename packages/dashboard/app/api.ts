import type { Task, TaskDetail, TaskCreateInput, Column, MergeResult, Settings } from "@hai/core";

async function api<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: string }).error || "Request failed");
  return data as T;
}

/**
 * Retry wrapper for API calls that may fail due to transient server errors
 * (e.g. 500s caused by concurrent file writes racing with reads).
 * Retries once after a short delay before giving up.
 */
async function withRetry<T>(fn: () => Promise<T>, { retries = 1, delayMs = 200 } = {}): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (retries <= 0) throw err;
    await new Promise((r) => setTimeout(r, delayMs));
    return withRetry(fn, { retries: retries - 1, delayMs });
  }
}

export function fetchTasks(): Promise<Task[]> {
  return api<Task[]>("/tasks");
}

export function fetchTaskDetail(id: string): Promise<TaskDetail> {
  return withRetry(() => api<TaskDetail>(`/tasks/${id}`));
}

export function createTask(input: TaskCreateInput): Promise<Task> {
  return api<Task>("/tasks", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function moveTask(id: string, column: Column): Promise<Task> {
  return api<Task>(`/tasks/${id}/move`, {
    method: "POST",
    body: JSON.stringify({ column }),
  });
}

export function deleteTask(id: string): Promise<Task> {
  return api<Task>(`/tasks/${id}`, { method: "DELETE" });
}

export function mergeTask(id: string): Promise<MergeResult> {
  return api<MergeResult>(`/tasks/${id}/merge`, { method: "POST" });
}

export function fetchConfig(): Promise<{ maxConcurrent: number }> {
  return api<{ maxConcurrent: number }>("/config");
}

export function fetchSettings(): Promise<Settings> {
  return api<Settings>("/settings");
}

export function updateSettings(settings: Partial<Settings>): Promise<Settings> {
  return api<Settings>("/settings", {
    method: "PUT",
    body: JSON.stringify(settings),
  });
}
