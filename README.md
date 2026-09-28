# Agent playground

A small monorepo for trying agent runtime ideas. The Python `agent_playground/` package defines a LangChain agent served by Aegra. The Hono `server/` exposes an AG-UI endpoint using the official remote LangGraph adapter. The React `web/` project is a chat and event viewer.

```text
web/ (AG-UI client) → server/ (AG-UI adapter) → Aegra run queue → agent_playground/
                                                ↘ PostgreSQL checkpoints
```

## Project structure

| Area | Main modules |
| --- | --- |
| `agent_playground/` | `graph.py` assembles the agent and tools; `workflow.py` runs the example workflow; `workflow_cards.py` builds A2UI messages; `workflow_outputs.py` persists step outputs. |
| `server/` | `app.ts` and `server.ts` are the HTTP and startup entry points; `agent/` adapts Aegra events to AG-UI; `conversation/` owns run admission, recovery and snapshots; `db/` owns the application database and schemas; `drizzle/` holds migrations. |
| `web/src/` | `conversation/` owns a scoped Zustand store and AG-UI session, TanStack Query snapshots, and local submission pointers; `chat/` renders messages, surfaces, composer and review form; `a2ui/` owns the custom catalog, official message validation, conversation runtime, surface renderer and component gallery; `layout/` contains sidebar and activity UI; `components/ui/` holds shadcn/ui primitives; `App.tsx` connects them. |

The [conversation recovery design](docs/superpowers/specs/2026-09-27-conversation-recovery-design.md) describes the data and protocol boundaries. The [validation record](docs/conversation-recovery-validation.md) lists the local end-to-end checks and their limits.

The web app keeps shadcn/ui primitives in `web/src/components/ui/`. To add another primitive, run `pnpm dlx shadcn@latest add <component>` from `web/`; `components.json` keeps the registry settings. The A2UI workflow catalog uses its own React components on top of the official A2UI renderer.

Each conversation has its own Zustand store. Components subscribe to the fields they display, while `HttpAgent` manages the AG-UI stream. TanStack Query fetches and caches server snapshots by thread ID, polls them every two seconds while the page is focused, and refreshes after a run ends or the page regains focus. Snapshot requests are cancellable. The composer waits for the initial snapshot before accepting input, and the gateway health indicator refreshes every 30 seconds. Only the thread pointer and an unconfirmed submission are persisted locally.

## Run locally

Requires Docker for PostgreSQL and Redis, plus uv, pnpm, Make, and a DeepSeek API key. The application processes run on the host for fast iteration.

```sh
make setup
# Set DEEPSEEK_API_KEY in the root .env file created by setup.
make dev
```

`make setup` creates three separate environment files: the root `.env` configures the Python agent and Aegra, `server/.env` configures the AG-UI server, and `web/.env` configures the Vite proxy. Each app reads its own file, and all three files are ignored by Git.

The agent uses LangChain's `ChatDeepSeek` integration and defaults to `deepseek-flash`. Set `DEEPSEEK_API_KEY` in the root `.env`; `DEEPSEEK_MODEL` can override the model. `ChatDeepSeek` supplies the default API endpoint, and `DEEPSEEK_API_BASE` is only needed for a custom endpoint. If you already have a root `.env`, replace its old `OPENAI_*` entries with the `DEEPSEEK_*` entries from `.env.example`.

`make dev` starts the infrastructure and all three application processes. Stop it with Ctrl+C. To run a process in its own terminal instead, use:

```sh
make infra-up
make agent
make server
make web
```

Run the last three commands in separate terminals. Use `make infra-down` to stop PostgreSQL and Redis. Run `make help` to list the shortcuts.

From the repository root, `uv run agent` serves Aegra using `HOST` and `PORT` from the root `.env`, while `pnpm dev:server` and `pnpm dev:web` run the TypeScript apps using their local `.env` files. The Makefile forwards to these commands.

Open `http://127.0.0.1:5173` for the web UI. The AG-UI endpoint is `POST http://127.0.0.1:3000/agent`; the native Aegra API is on `http://127.0.0.1:2026`. PostgreSQL and Redis are exposed locally on ports `55432` and `56379`.

PostgreSQL keeps Aegra's service tables, Alembic history, checkpoints, and store in the `aegra` schema. The playground's conversation and workflow output tables use `public`. The TypeScript server applies its Drizzle migrations at startup; the Python graph prepares the workflow output table when it starts. Compose creates a local `aegra` database role with `search_path = aegra` when it initializes a new PostgreSQL volume; the existing `agent` role is used for application tables in `public`. Aegra uses `DATABASE_URL` from the root `.env` and should connect as `aegra`. Both the root `.env` and `server/.env` need their own `APP_DATABASE_URL` pointing to the application role.

PostgreSQL 18 mounts its data at `/var/lib/postgresql`; a volume initialized by PostgreSQL 17 cannot be reused. To recreate an older volume, run `docker compose down --volumes` followed by `make infra-up`. This deletes local PostgreSQL data.

The server creates Aegra runs via `@ag-ui/langgraph`. Agent execution goes through Aegra's queue and thread concurrency handling. Hono handles HTTP and SSE streaming. The React web UI uses `@ag-ui/client`, Tailwind CSS, shadcn/ui chat and form components, and Markdown rendering to show chat replies alongside AG-UI events. The transcript follows new output while the reader is at the bottom, preserves the reading position when scrolled up, and offers a scroll-to-end button. This is a local playground; the server does not provide authentication or durable AG-UI event replay. It stores completed messages, workflow outputs, and run summaries so the UI can recover after a disconnect.

## Call the AG-UI endpoint

```sh
curl --no-buffer -X POST http://127.0.0.1:3000/agent \
  -H 'Content-Type: application/json' \
  -H 'Accept: text/event-stream' \
  -d '{
    "threadId": "8af32af0-715d-47be-a4a2-0678a532e5da",
    "runId": "b50da20d-b907-43dd-a284-d88995796b9e",
    "messages": [{"id": "2e455cc4-7507-4c9e-95f9-a785e08c5abb", "role": "user", "content": "What time is it now?"}],
    "tools": [],
    "context": [],
    "state": {}
  }'
```

The original `get_current_time` tool is still built into the agent. The local MCP server exposes `calculate_sum`; Aegra loads it through the LangChain MCP adapter when the graph starts. The `run_experiment_workflow` tool runs a small LangGraph workflow with visible steps and one human review point. Try "Use the MCP tool to add 12 and 30" or "Create an experiment plan for testing an agent workflow" in the web UI.

Each workflow step emits an A2UI v0.9 surface: captured idea, draft plan, review request, and review result. The review step also pauses with a LangGraph interrupt. The AG-UI adapter exposes the pause through `RUN_FINISHED.outcome`; the web UI lets you edit and approve the draft or reject it, then resumes the same thread with `resume[]`.

Python constructs the official `{ messages: [...] }` model and saves each output before emitting an AG-UI `CUSTOM` event named `a2ui`. Its value contains `id`, `outputSeq`, run/tool ownership and the standard `messages` array. The server forwards the event and exposes saved outputs through `GET /conversations/:threadId`. One official `MessageProcessor` per web conversation consumes both sources in `outputSeq` order, deduplicates repeated outputs, and supports multiple surfaces, component/data updates and deletion. `WorkflowText` supports official dynamic string bindings such as `{ "path": "/title" }`. The renderer uses the custom workflow catalog and official React surface renderer. Sequence gaps trigger snapshot recovery; malformed or conflicting output displays an error. Because the processor does not roll back a failed batch, affected surfaces are hidden and further A2UI processing stops for that conversation session.

Open `/a2ui` to select a registered component and edit its JSON example in a local Monaco editor; the adjacent preview updates from valid A2UI JSON. Example files live in `web/src/a2ui/examples/`. The preview requires a complete surface with a root component and keeps the last valid result while JSON is invalid. Conversation ingestion also accepts update-only batches. A2UI actions are not connected to the backend; review submission continues to use the separate review form.

The current output format has version 3. Legacy `kind: "a2ui"` wrappers, `experiment_card` events and Basic Catalog surfaces are unsupported. Existing database rows are retained; start a new conversation after upgrading. Local storage holds only the thread pointer and an unconfirmed submission for retry. `GET /conversations` lists recent threads. A disconnected browser does not cancel the Aegra run. If a server crash leaves Aegra run creation unconfirmed, the server checks only the newest Aegra run for that thread. When it cannot confirm the mapping, the submission becomes `submission_unknown` and the UI does not retry it automatically. Aegra's native Agent Protocol stream is also available at `POST /runs/stream` on port `2026`.

## Observability

Run `make dev-observability` to start the optional local Langfuse, Collector, Prometheus, and Grafana stack together with tracing-enabled apps. Langfuse is on `http://127.0.0.1:3031`; Grafana is on `http://127.0.0.1:3032`. The graph factory restores persisted W3C trace context around each worker execution, connecting browser, server, model, and tool spans without modifying Aegra. See [the observability guide](docs/observability.md) for local credentials, individual commands, deployment settings, metric semantics, and current limits.

## Develop and check

```sh
make check
make format
```

`make check` runs Pyrefly and TypeScript type checking, Ruff and ESLint linting, Ruff and Prettier format checks, Python, server and web tests, and the web build. `make format` applies the Python and frontend formatters. Individual targets such as `make typecheck`, `make lint`, `make format-check`, `make test`, and `make build` are available when a faster check is useful. Web linting checks Tailwind class names, including canonical forms such as `max-w-205`.

GitHub Actions runs the Python, server, and web checks in parallel for pull requests and pushes to `main`. The Python job uses Testcontainers and needs no DeepSeek API key.

Pyrefly uses its strict preset. Ruff keeps its default checks and adds import sorting, common bug checks, and Python syntax upgrades; its formatter uses the default 88-character line length. Both TypeScript projects enable strict checking, unchecked index access, exact optional properties, and verbatim module syntax. ESLint uses the JavaScript and type-aware TypeScript recommended rules, with React Hooks rules for the web app. Prettier uses its defaults, while `.editorconfig` defines indentation and line endings for editors.

The PostgreSQL tests use Testcontainers to start temporary `postgres:18-alpine` containers. `make test` and `make check` need a running Docker daemon, but do not need the Compose database or a `TEST_DATABASE_URL` variable.
