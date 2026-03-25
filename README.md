# hai

AI-orchestrated task board. Like Trello, but your tasks get specified, executed, and delivered by AI — powered by [pi](https://github.com/badlogic/pi-mono).

## Workflow

```
┌──────────┐    ┌──────────┐    ┌────────────┐    ┌───────────┐    ┌──────┐
│  Triage  │───▶│   Todo   │───▶│ In Progress│───▶│ In Review │───▶│ Done │
│          │    │          │    │            │    │           │    │      │
│ raw idea │    │ AI spec'd│    │ AI working │    │ ready to  │    │merged│
│          │    │ & ready  │    │ in worktree│    │   merge   │    │      │
└──────────┘    └──────────┘    └────────────┘    └───────────┘    └──────┘
    pi               ▲              pi                human
 specifies      deps gate        executes            reviews
```

1. **Triage** — Throw rough ideas in. Pi picks them up and writes a proper task spec.
2. **Todo** — Fully specified, ready to go. Scheduler moves them when deps are met.
3. **In Progress** — Pi works the task in an isolated git worktree.
4. **In Review** — Work is done. Merge the worktree and close.
5. **Done** — Shipped.

Tasks with dependencies are processed sequentially. Independent tasks run in parallel.

## Quick Start

```bash
# Install dependencies
pnpm install

# Start the board (UI only)
pnpm dev dashboard

# Start with AI engine (auto-specify + auto-execute)
pnpm dev dashboard -- --engine

# Create a task via CLI
pnpm dev task create "Fix the login redirect bug"

# List tasks
pnpm dev task list

# Move a task
pnpm dev task move HAI-001 todo
```

Then open [http://localhost:4040](http://localhost:4040).

## Prerequisites

The AI engine uses [pi](https://github.com/badlogic/pi-mono) agent sessions under the hood. You need:

1. **pi installed:** `npm install -g @mariozechner/pi-coding-agent`
2. **API key configured:** Run `pi` and use `/login` or set `ANTHROPIC_API_KEY`

hai reuses your existing pi authentication — no separate setup needed.

## Packages

| Package | Description |
|---------|-------------|
| `@hai/core` | Domain model — tasks, board columns, file-based store |
| `@hai/dashboard` | Web UI — Express server + kanban board with SSE |
| `@hai/engine` | AI engine — triage (pi), execution (pi + worktrees), scheduling |
| `hai` (cli) | CLI — `hai dashboard`, `hai task create/list/move` |

## Architecture

### Task Storage

Tasks live on disk in `.hai/tasks/` in the project root:

```
.hai/
├── config.json              # Board config + ID counter
└── tasks/
    └── HAI-001/
        ├── task.json        # Metadata (column, deps, timestamps)
        └── PROMPT.md        # Task specification
```

### Board UI

Real-time kanban board at `localhost:4040`:
- Drag-and-drop cards between columns
- Create tasks from the web UI
- Click cards for detail view with move/delete actions
- Server-Sent Events for live updates across tabs

### AI Engine (`--engine`)

When enabled, three components run:

- **TriageProcessor** — Watches triage column. Spawns a pi agent session that reads the project, understands context, and writes a full PROMPT.md specification. Moves task to todo.

- **Scheduler** — Watches todo column. Resolves dependency graphs. Moves tasks to in-progress when deps are satisfied and concurrency allows (default: 2 concurrent).

- **TaskExecutor** — Listens for tasks entering in-progress. Creates a git worktree, spawns a pi agent session with full coding tools scoped to the worktree, and executes the specification. Moves to in-review on completion.

Each pi agent session gets:
- Custom system prompt for its role (triage specifier vs task executor)
- Tools scoped to the correct directory (`createCodingTools(cwd)`)
- In-memory sessions (no persistence needed)
- The user's existing pi auth (API keys from `~/.pi/agent/auth.json`)

## Development

```bash
pnpm install
pnpm dev dashboard              # Board only
pnpm dev dashboard -- --engine  # Board + AI engine
pnpm dev task list              # CLI commands
```

## License

ISC
