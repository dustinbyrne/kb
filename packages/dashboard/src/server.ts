import express from "express";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { TaskStore } from "@hai/core";
import { createApiRoutes } from "./routes.js";
import { createSSE } from "./sse.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createServer(store: TaskStore) {
  const app = express();

  app.use(express.json());
  app.use(express.static(join(__dirname, "..", "public")));

  // SSE endpoint
  app.get("/api/events", createSSE(store));

  // REST API
  app.use("/api", createApiRoutes(store));

  // SPA fallback
  app.get("/{*splat}", (_req, res) => {
    res.sendFile(join(__dirname, "..", "public", "index.html"));
  });

  return app;
}
