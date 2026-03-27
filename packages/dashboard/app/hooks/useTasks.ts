import { useState, useEffect, useCallback, useRef } from "react";
import type { Task, Column, TaskCreateInput, MergeResult } from "@kb/core";
import * as api from "../api";

export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  // Fetch initial tasks
  useEffect(() => {
    api.fetchTasks().then(setTasks).catch(() => setTasks([]));
  }, []);

  // SSE live updates
  useEffect(() => {
    const es = new EventSource("/api/events");

    es.addEventListener("task:created", (e) => {
      const task: Task = JSON.parse(e.data);
      setTasks((prev) => [...prev, task]);
    });

    es.addEventListener("task:moved", (e) => {
      const { task }: { task: Task } = JSON.parse(e.data);
      setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)));
    });

    es.addEventListener("task:updated", (e) => {
      const task: Task = JSON.parse(e.data);
      setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)));
    });

    es.addEventListener("task:deleted", (e) => {
      const task: Task = JSON.parse(e.data);
      setTasks((prev) => prev.filter((t) => t.id !== task.id));
    });

    es.addEventListener("task:merged", (e) => {
      const { task }: { task: Task } = JSON.parse(e.data);
      setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)));
    });

    es.addEventListener("error", () => {
      setTimeout(() => {
        if (es.readyState === EventSource.CLOSED) {
          // Will reconnect via new effect cycle
        }
      }, 3000);
    });

    return () => es.close();
  }, []);

  const createTask = useCallback(async (input: TaskCreateInput): Promise<Task> => {
    return api.createTask(input);
  }, []);

  const moveTask = useCallback(async (id: string, column: Column): Promise<Task> => {
    return api.moveTask(id, column);
  }, []);

  const deleteTask = useCallback(async (id: string): Promise<Task> => {
    return api.deleteTask(id);
  }, []);

  const mergeTask = useCallback(async (id: string): Promise<MergeResult> => {
    return api.mergeTask(id);
  }, []);

  const retryTask = useCallback(async (id: string): Promise<Task> => {
    return api.retryTask(id);
  }, []);

  return { tasks, createTask, moveTask, deleteTask, mergeTask, retryTask };
}
