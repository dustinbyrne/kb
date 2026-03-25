import type { Task } from "@hai/core";

export interface WorktreeGroupData {
  label: string;
  activeTasks: Task[];
  queuedTasks: Task[];
}

/**
 * Extract a clean display name from a worktree path.
 * e.g. ".worktrees/HAI-001" → "HAI-001", "/path/to/hai/hai-001" → "hai-001"
 */
export function getWorktreeLabel(worktreePath: string): string {
  // Take the last segment of the path
  const segments = worktreePath.replace(/\/+$/, "").split("/");
  return segments[segments.length - 1] || worktreePath;
}

/**
 * Topological sort of tasks by dependency order.
 * Mirrors resolveDependencyOrder from @hai/core but inlined to avoid
 * build alias issues (Vite aliases @hai/core to types.ts only).
 */
function resolveDependencyOrder(tasks: Task[]): string[] {
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const ordered: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(id: string): void {
    if (visited.has(id)) return;
    if (visiting.has(id)) return;
    visiting.add(id);
    const task = taskMap.get(id);
    if (task) {
      for (const depId of task.dependencies || []) {
        if (taskMap.has(depId)) visit(depId);
      }
    }
    visiting.delete(id);
    visited.add(id);
    ordered.push(id);
  }

  for (const task of tasks) visit(task.id);
  return ordered;
}

/**
 * Group in-progress tasks by worktree and distribute queued todo tasks
 * as visual previews across the worktree groups.
 */
export function groupByWorktree(
  inProgressTasks: Task[],
  allTasks: Task[],
  maxConcurrent: number,
): WorktreeGroupData[] {
  // Separate assigned vs unassigned in-progress tasks
  const assigned = inProgressTasks.filter((t) => t.worktree);
  const unassigned = inProgressTasks.filter((t) => !t.worktree);

  // Group assigned tasks by worktree
  const worktreeMap = new Map<string, Task[]>();
  for (const task of assigned) {
    const key = task.worktree!;
    const list = worktreeMap.get(key) || [];
    list.push(task);
    worktreeMap.set(key, list);
  }

  // Find queued todo tasks: "todo" tasks with all deps satisfied (done or in-review)
  const taskById = new Map(allTasks.map((t) => [t.id, t]));
  const todoTasks = allTasks.filter((t) => t.column === "todo");
  const eligible = todoTasks.filter((t) =>
    (t.dependencies || []).every((depId) => {
      const dep = taskById.get(depId);
      return dep && (dep.column === "done" || dep.column === "in-review");
    }),
  );

  // Order eligible tasks by dependency order
  const orderedIds = resolveDependencyOrder(eligible);
  const orderedEligible = orderedIds
    .map((id) => taskById.get(id))
    .filter((t): t is Task => t !== undefined && eligible.includes(t));

  // Build groups from worktree map
  const groups: WorktreeGroupData[] = [];
  const worktreeKeys = Array.from(worktreeMap.keys());

  for (const key of worktreeKeys) {
    groups.push({
      label: getWorktreeLabel(key),
      activeTasks: worktreeMap.get(key)!,
      queuedTasks: [],
    });
  }

  // Add unassigned group if needed
  if (unassigned.length > 0) {
    groups.push({
      label: "Unassigned",
      activeTasks: unassigned,
      queuedTasks: [],
    });
  }

  // Distribute queued tasks round-robin across active worktree groups (one per group)
  const activeGroups = groups.filter((g) => g.label !== "Unassigned");
  let queueIdx = 0;

  if (activeGroups.length > 0 && orderedEligible.length > 0) {
    for (let i = 0; i < activeGroups.length && queueIdx < orderedEligible.length; i++) {
      activeGroups[i].queuedTasks.push(orderedEligible[queueIdx++]);
    }
  }

  // Remaining queued tasks go into "Up Next" overflow group
  if (queueIdx < orderedEligible.length) {
    const remaining = orderedEligible.slice(queueIdx, queueIdx + maxConcurrent);
    if (remaining.length > 0) {
      groups.push({
        label: "Up Next",
        activeTasks: [],
        queuedTasks: remaining,
      });
    }
  }

  return groups;
}
