---
name: kb-task
description: Create, manage, and track tasks on the kb board. Use when asked to create a task, file a bug, report an issue, check task status, update progress, or interact with the kb task board in any way.
---

# kb task

kb is an AI-orchestrated task board. Tasks flow through columns:
**triage → todo → in-progress → in-review → done**

## Commands

### Create a task

```bash
kb task create "description of what needs to be done"
kb task create "button is misaligned" --attach screenshot.png
kb task create "server crash" --attach error.log --attach trace.txt
```

Creates a task in **triage**. The AI triage agent will specify it into a full
PROMPT.md with steps, file scope, review level, and acceptance criteria, then
move it to **todo**.

Options:
- `--attach <file>` — attach files (images, logs, configs). Repeatable.
  Images are sent to the triage agent for visual context.
  Files are stored in `.kb/tasks/KB-XXX/attachments/`.

Tips:
- Be descriptive — the triage agent uses this to write the spec
- Include the problem AND desired outcome when possible
- For bugs, describe the current behavior and expected behavior
- Attach screenshots for UI bugs — the AI can see them
- No need to specify how to fix it — the triage agent figures that out

### List tasks

```bash
kb task list
```

Shows all tasks grouped by column with IDs and descriptions.

### Show task details

```bash
kb task show KB-001
```

Shows full task info: steps, progress, log entries, dependencies.

### Move a task

```bash
kb task move KB-001 <column>
```

Columns: `triage`, `todo`, `in-progress`, `in-review`, `done`

Transitions are validated:
- triage → todo
- todo → in-progress, triage
- in-progress → in-review
- in-review → done, in-progress
- done → (none)

### Update step status

```bash
kb task update KB-001 <step-number> <status>
```

Status: `pending`, `in-progress`, `done`, `skipped`

Steps are 0-indexed and auto-parsed from the PROMPT.md headings.

### Log an entry

```bash
kb task log KB-001 "what happened"
```

Adds a timestamped log entry visible on the task card.

### Merge a completed task

```bash
kb task merge KB-001
```

Squash-merges the task's branch into main with an AI-written commit message.
Only works for tasks in **in-review**. Resolves conflicts via AI if needed.
Cleans up the worktree and branch after merge.

## Workflow

1. **Create** — `kb task create "description"` → goes to triage
2. **Triage** — AI agent reads the codebase, writes a PROMPT.md spec, moves to todo
3. **Schedule** — Scheduler moves to in-progress when deps are met and concurrency allows
4. **Execute** — AI agent works the task in a git worktree, reports progress via tools
5. **Review** — Cross-model reviewer checks plan/code at step boundaries
6. **Merge** — `kb task merge KB-001` squash-merges to main

## Filing good tasks

A task can be anything from a rough idea to a detailed spec:

```bash
# Rough — triage agent will flesh it out
kb task create "the login page is slow"

# Specific — triage agent will structure it
kb task create "Add rate limiting to POST /api/tasks. Use a token bucket algorithm with 100 req/min per IP. Return 429 with Retry-After header when exceeded."

# Bug report with screenshot
kb task create "button is misaligned on mobile" --attach screenshot.png

# Bug report with logs
kb task create "server crashes on startup" --attach crash.log
```
