import { useCallback, useState } from "react";
import type { Task, TaskDetail } from "@hai/core";
import { fetchTaskDetail } from "../api";
import type { ToastType } from "../hooks/useToast";

interface TaskCardProps {
  task: Task;
  queued?: boolean;
  onOpenDetail: (task: TaskDetail) => void;
  addToast: (message: string, type?: ToastType) => void;
}

export function TaskCard({ task, queued, onOpenDetail, addToast }: TaskCardProps) {
  const [dragging, setDragging] = useState(false);

  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.dataTransfer.setData("text/plain", task.id);
    e.dataTransfer.effectAllowed = "move";
    setDragging(true);
  }, [task.id]);

  const handleDragEnd = useCallback(() => {
    setDragging(false);
  }, []);

  const handleClick = useCallback(async () => {
    try {
      const detail = await fetchTaskDetail(task.id);
      onOpenDetail(detail);
    } catch (err: any) {
      addToast(err.message, "error");
    }
  }, [task.id, onOpenDetail, addToast]);

  const cardClass = `card${dragging ? " dragging" : ""}${queued ? " queued" : ""}`;

  return (
    <div
      className={cardClass}
      data-id={task.id}
      draggable={!queued}
      onDragStart={queued ? undefined : handleDragStart}
      onDragEnd={queued ? undefined : handleDragEnd}
      onClick={handleClick}
    >
      <span className="card-id">{task.id}</span>
      <div className="card-title">{task.title}</div>
      {((task.dependencies && task.dependencies.length > 0) || queued) && (
        <div className="card-meta">
          {task.dependencies && task.dependencies.length > 0 && (
            <span className="card-dep-badge">
              ⛓ {task.dependencies.length} dep{task.dependencies.length > 1 ? "s" : ""}
            </span>
          )}
          {queued && <span className="queued-badge">⏳ Queued</span>}
        </div>
      )}
    </div>
  );
}
