import type { Request, Response } from "express";
import type { TaskStore } from "@kb/core";

export function createSSE(store: TaskStore) {
  return (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    // Send initial heartbeat
    res.write(": connected\n\n");

    const onCreated = (task: any) => {
      res.write(`event: task:created\ndata: ${JSON.stringify(task)}\n\n`);
    };
    const onMoved = (data: any) => {
      res.write(`event: task:moved\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const onUpdated = (task: any) => {
      res.write(`event: task:updated\ndata: ${JSON.stringify(task)}\n\n`);
    };
    const onDeleted = (task: any) => {
      res.write(`event: task:deleted\ndata: ${JSON.stringify(task)}\n\n`);
    };
    const onMerged = (result: any) => {
      res.write(`event: task:merged\ndata: ${JSON.stringify(result)}\n\n`);
    };

    store.on("task:created", onCreated);
    store.on("task:moved", onMoved);
    store.on("task:updated", onUpdated);
    store.on("task:deleted", onDeleted);
    store.on("task:merged", onMerged);

    // Heartbeat every 30s to keep connection alive
    const heartbeat = setInterval(() => {
      res.write(": heartbeat\n\n");
    }, 30_000);

    _req.on("close", () => {
      clearInterval(heartbeat);
      store.off("task:created", onCreated);
      store.off("task:moved", onMoved);
      store.off("task:updated", onUpdated);
      store.off("task:deleted", onDeleted);
      store.off("task:merged", onMerged);
    });
  };
}
