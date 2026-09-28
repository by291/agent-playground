# Agent playground

A small monorepo for trying agent runtime ideas. The Python `agent_playground/` package defines a LangChain agent served by Aegra. The Hono `server/` exposes an AG-UI endpoint using the official remote LangGraph adapter. The React `web/` project is a chat and event viewer.

```text
web/ (AG-UI client) → server/ (AG-UI adapter) → Aegra run queue → agent_playground/
                                                ↘ PostgreSQL checkpoints
```

## Project structure

| Area | Main modules |
| --- | --- |
| `agent_playground/` | `graph.py` assembles the agent and tools; `workflow.py` runs the example workflow; `workflow_cards.py` builds experiment cards; `workflow_outputs.py` publishes durable outputs; `db/` owns SQLAlchemy contracts, connection setup and output persistence. |
| `server/` | `app.ts` and `server.ts` are the HTTP and startup entry points; `agent/` owns the shared Aegra client, protocol adaptation and SSE transport; `conversation/` owns submission coordination, conditional run updates, checkpoint synchronization and read-only snapshots; `db/` owns the application database and schemas; `drizzle/` holds migrations. |
| `web/src/` | `conversation/` separates submission execution, pure snapshot reconciliation, scoped session state, Query delivery and local pointers; `chat/` renders messages, surfaces, composer and review form; `a2ui/` owns the catalog, `components/`, official validation, ordered runtime and disposable gallery previews; `layout/` contains sidebar and activity UI; `components/ui/` holds shadcn/ui primitives; `App.tsx` connects them. |
| `shared/` | The application run-status contract used by the TypeScript server and web app; protocol schemas remain owned by their official libraries. |

The [conversation recovery design](docs/superpowers/specs/2026-09-27-conversation-recovery-design.md) describes the data and protocol boundaries. The [validation record](docs/conversation-recovery-validation.md) lists the local end-to-end checks and their limits.

The web app keeps shadcn/ui primitives in `web/src/components/ui/`. To add another primitive, run `pnpm dlx shadcn@latest add <component>` from `web/`; `components.json` keeps the registry settings. The A2UI workflow catalog uses its own React components on top of the official A2UI renderer.

Each conversation has its own Zustand store. Components subscribe to the fields they display, while `HttpAgent` manages the AG-UI stream. TanStack Query fetches and caches server snapshots by thread ID and refreshes after a run ends or the page regains focus. Two-second polling is enabled only for recovery while the page is focused: unfinished or unknown server runs without a live local stream, failed snapshot requests, a finished local run not yet present in the snapshot, or missing saved A2UI output. Idle conversations and healthy local streams do not poll. Snapshot requests are cancellable. The composer waits for the initial snapshot before accepting input, and the gateway health indicator refreshes every 30 seconds. The browser persists the thread pointer, an unconfirmed submission and an empty-conversation hint. A new or known empty conversation renders its welcome page immediately on reload; other conversations show a message skeleton while history recovers.

Query delivers each fresh result through the session once. The server synchronizes the latest run before reading its snapshot; completed and interrupted checkpoints are marked as synchronized in PostgreSQL, including their interrupts. Later polls read saved messages and outputs without re-fetching that checkpoint. Message synchronization inserts new IDs in one batch and saves their checkpoint order. Admission checks the newest run under the conversation lock; existing identical submissions are recognized before validating a new review, so a prepared review can be retried after restart. Run observations update only the state and Aegra mapping they originally read, so late callbacks and older upstream responses cannot reopen a terminal run. Upstream and database failures return `503`; invalid submissions and admission conflicts return `400` or `409`.

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

The chat shows one current experiment-plan card per workflow tool call. Earlier stage surfaces stay available inside the tool process. While review is pending, editable title and steps replace the review-request card, with direct **Approve plan** and **Reject** actions. Parallel plans require an explicit decision for each plan before **Continue workflow** submits the batch. The reviewed result replaces the editor in the same reply, including after refresh; subsequent model replies briefly acknowledge the outcome instead of repeating the plan. Saved node outputs keep their original A2UI payloads so existing conversations can still recover and resume.

Python constructs the official `{ messages: [...] }` model and saves each output before emitting an AG-UI `CUSTOM` event named `a2ui`. Its value contains `id`, `outputSeq`, run/tool ownership and the standard `messages` array. The server forwards the event and exposes saved outputs through `GET /conversations/:threadId`. One official `MessageProcessor` per web conversation consumes both sources in `outputSeq` order, deduplicates repeated outputs, and supports multiple surfaces, component/data updates and deletion. `WorkflowText` supports official dynamic string bindings such as `{ "path": "/title" }`. The renderer uses the custom workflow catalog and official React surface renderer. Sequence gaps trigger snapshot recovery; malformed or conflicting output displays an error. Because the processor does not roll back a failed batch, affected surfaces are hidden and further A2UI processing stops for that conversation session.

In development, **Components** in the chat header opens `/dev/a2ui-components` in a new tab. Choose a registered component with the shared Select control and edit its JSON example in the local Monaco editor; the adjacent preview updates from valid A2UI JSON. Chat and component pages have distinct browser-tab titles and share the app icon. **Activity** is also development-only. Production builds omit both controls and the component gallery. Example files live in `web/src/a2ui/examples/`. The preview requires a complete surface with a root component and keeps the last valid result while JSON is invalid. Conversation ingestion also accepts update-only batches. A2UI actions are not connected to the backend; review submission continues to use the separate review form.

Each component keeps its schema and renderer together in `web/src/a2ui/components/`; `catalog.tsx` registers them. The gallery owns preview models and releases them on replacement, reset and unmount. A2UI ingestion distinguishes ready, waiting and failed results: a sequence gap that recovers successfully does not mark the submission trace as an error.

The current output format has version 3. Legacy `kind: "a2ui"` wrappers, `experiment_card` events and Basic Catalog surfaces are unsupported. Existing database rows are retained; start a new conversation after upgrading. Local storage holds the thread pointer, an empty-conversation hint and an unconfirmed submission for retry. `GET /conversations` lists recent threads. A disconnected browser does not cancel the Aegra run. If a server crash leaves Aegra run creation unconfirmed, the server checks only the newest Aegra run for that thread. When it cannot confirm the mapping, the submission becomes `submission_unknown` and the UI does not resend it. Later polls can recover a mapping confirmed by that same bounded lookup; a persistently unconfirmed submission requires manual reconciliation. Aegra's native Agent Protocol stream is also available at `POST /runs/stream` on port `2026`.

## Context management

The agent uses LangChain's `SummarizationMiddleware` to compact older messages automatically when estimated context usage reaches 80% of the model window. It retains recent messages within a 20% token budget, preserving tool-call/result pairs, and replaces earlier history with a summary saved in the checkpoint. The summarization call receives all selected history without the middleware's default 4,000-token truncation. It uses the same DeepSeek model with thinking disabled and a 4,096-token output limit; summary failures propagate without replacing history. A single oversized turn that still exceeds the window after compaction is rejected rather than silently truncated.

The root `.env` can override `CONTEXT_COMPACT_RATIO` (greater than `0.2` and less than `1`) and `CONTEXT_WINDOW_TOKENS`. The window otherwise comes from LangChain's model profile; a custom DeepSeek model without a profile requires an explicit window. Changing these settings requires restarting the agent.

The header's context ring opens estimated token usage and a breakdown of system instructions, tool definitions, conversation messages (including tool-call arguments), tool results, and summaries. Counts use LangChain's approximate counter with a conservative two-character-per-token ratio; they are estimates, including for Chinese text, rather than an exact tokenizer or billing measurement. Provider-reported input tokens from the last model request are shown separately when available. Usage refreshes at model boundaries, so text still streaming and unsent composer input are not yet counted.

The browser sends only the newest user message for a normal turn. Aegra's checkpoint owns model history; archived chat is not reintroduced after compaction. The complete public transcript is kept separately in the application database. Internal summaries and compressed message snapshots do not replace that transcript. Current-run replies are kept in checkpoint state until synchronization so compaction during a tool loop cannot erase recoverable replies. Context usage is synchronized with the latest finished or interrupted checkpoint and recovered after reload without extra upstream reads on every poll.

## Tool process in chat

Each user turn has one assistant reply area. Tool calls appear in a collapsed process above the final answer. Expanding the process shows the assistant's accompanying text and each tool's execution status; expanding a tool shows its parameters and raw result. This text is ordinary assistant content, not private reasoning. A user-opened process stays open when the run finishes. Tool failures remain visible while collapsed, and workflow cards and review forms remain directly accessible outside the process.

Assistant tool calls and tool results are archived as official AG-UI messages in `conversation_messages`, including empty assistant messages that contain tool calls. The Python checkpoint keeps these public messages recoverable across context compaction and review resumes. Refresh restores the saved process, initially collapsed. Previously archived text-only replies still share one assistant area, but their missing tool metadata is not reconstructed from text.

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

The Python and server PostgreSQL tests use Testcontainers to start temporary `postgres:18-alpine` containers. `make test` and `make check` need a running Docker daemon, but do not need the Compose database or a `TEST_DATABASE_URL` variable.
