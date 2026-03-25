import { TaskStore, COLUMNS, COLUMN_LABELS, type Column } from "@hai/core";
import { createInterface } from "node:readline/promises";

async function getStore(): Promise<TaskStore> {
  const store = new TaskStore(process.cwd());
  await store.init();
  return store;
}

export async function runTaskCreate(titleArg?: string) {
  let title = titleArg;

  if (!title) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    title = await rl.question("Task title: ");
    rl.close();
  }

  if (!title?.trim()) {
    console.error("Title is required");
    process.exit(1);
  }

  const store = await getStore();
  const task = await store.createTask({ title: title.trim() });

  console.log();
  console.log(`  ✓ Created ${task.id}: ${task.title}`);
  console.log(`    Column: triage`);
  console.log(`    Path:   .hai/tasks/${task.id}/`);
  console.log();
}

export async function runTaskList() {
  const store = await getStore();
  const tasks = await store.listTasks();

  if (tasks.length === 0) {
    console.log("\n  No tasks yet. Create one with: hai task create\n");
    return;
  }

  console.log();

  for (const col of COLUMNS) {
    const colTasks = tasks.filter((t) => t.column === col);
    if (colTasks.length === 0) continue;

    const label = COLUMN_LABELS[col];
    const dot =
      col === "triage" ? "●" :
      col === "todo" ? "●" :
      col === "in-progress" ? "●" :
      col === "in-review" ? "●" : "○";

    console.log(`  ${dot} ${label} (${colTasks.length})`);
    for (const t of colTasks) {
      const deps = t.dependencies.length ? ` [deps: ${t.dependencies.join(", ")}]` : "";
      console.log(`    ${t.id}  ${t.title}${deps}`);
    }
    console.log();
  }
}

export async function runTaskMove(id: string, column: string) {
  if (!COLUMNS.includes(column as Column)) {
    console.error(`Invalid column: ${column}`);
    console.error(`Valid columns: ${COLUMNS.join(", ")}`);
    process.exit(1);
  }

  const store = await getStore();
  const task = await store.moveTask(id, column as Column);

  console.log();
  console.log(`  ✓ Moved ${task.id} → ${COLUMN_LABELS[task.column as Column]}`);
  console.log();
}
