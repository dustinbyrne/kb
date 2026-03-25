import { Router } from "express";
import type { TaskStore, Column } from "@hai/core";
import { COLUMNS } from "@hai/core";

export function createApiRoutes(store: TaskStore): Router {
  const router = Router();

  // List all tasks
  router.get("/tasks", async (_req, res) => {
    try {
      const tasks = await store.listTasks();
      res.json(tasks);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get single task with prompt content
  router.get("/tasks/:id", async (req, res) => {
    try {
      const task = await store.getTask(req.params.id);
      res.json(task);
    } catch (err: any) {
      res.status(404).json({ error: `Task ${req.params.id} not found` });
    }
  });

  // Create task
  router.post("/tasks", async (req, res) => {
    try {
      const { title, description, column, dependencies } = req.body;
      if (!title || typeof title !== "string") {
        res.status(400).json({ error: "title is required" });
        return;
      }
      const task = await store.createTask({
        title,
        description,
        column,
        dependencies,
      });
      res.status(201).json(task);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Move task to column
  router.post("/tasks/:id/move", async (req, res) => {
    try {
      const { column } = req.body;
      if (!column || !COLUMNS.includes(column as Column)) {
        res.status(400).json({
          error: `Invalid column. Must be one of: ${COLUMNS.join(", ")}`,
        });
        return;
      }
      const task = await store.moveTask(req.params.id, column as Column);
      res.json(task);
    } catch (err: any) {
      const status = err.message.includes("Invalid transition") ? 400 : 500;
      res.status(status).json({ error: err.message });
    }
  });

  // Update task
  router.patch("/tasks/:id", async (req, res) => {
    try {
      const { title, description, prompt } = req.body;
      const task = await store.updateTask(req.params.id, {
        title,
        description,
        prompt,
      });
      res.json(task);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Merge task (in-review → done, merges branch + cleans worktree)
  router.post("/tasks/:id/merge", async (req, res) => {
    try {
      const result = await store.mergeTask(req.params.id);
      res.json(result);
    } catch (err: any) {
      const status = err.message.includes("Cannot merge") ? 400
        : err.message.includes("Merge conflict") ? 409
        : 500;
      res.status(status).json({ error: err.message });
    }
  });

  // Delete task
  router.delete("/tasks/:id", async (req, res) => {
    try {
      const task = await store.deleteTask(req.params.id);
      res.json(task);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
