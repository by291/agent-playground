# Agent playground

A small monorepo for trying agent runtime ideas. The Python `agent_playground/` package defines a LangChain agent served by Aegra. The Hono `server/` exposes an AG-UI endpoint using the official remote LangGraph adapter. The React `web/` project is a chat and event viewer.

```text
web/ (AG-UI client) → server/ (AG-UI adapter) → Aegra run queue → agent_playground/
                                                ↘ PostgreSQL checkpoints
```

## Run locally

Requires Docker for PostgreSQL and Redis, plus uv, pnpm, Make, and an OpenAI API key or compatible endpoint. The application processes run on the host for fast iteration.

```sh
make setup
# Set OPENAI_API_KEY in the .env file created by setup.
make dev
```

`make dev` starts the infrastructure and all three application processes. Stop it with Ctrl+C. To run a process in its own terminal instead, use:

```sh
make infra-up
make agent
make server
make web
```

Run the last three commands in separate terminals. Use `make infra-down` to stop PostgreSQL and Redis. Run `make help` to list the shortcuts.

From the repository root, `uv run agent` serves Aegra using `HOST` and `PORT` from `.env`, while `pnpm dev:server` and `pnpm dev:web` run the TypeScript apps. The Makefile forwards to these commands.

Open `http://127.0.0.1:5173` for the web UI. The AG-UI endpoint is `POST http://127.0.0.1:3000/agent`; the native Aegra API is on `http://127.0.0.1:2026`. PostgreSQL and Redis are exposed locally on ports `55432` and `56379`.

The server creates Aegra runs via `@ag-ui/langgraph`. Agent execution goes through Aegra's queue and thread concurrency handling. Hono handles HTTP and SSE streaming. The React web UI uses `@ag-ui/client`, Tailwind CSS, and Markdown rendering to show chat replies alongside AG-UI events. This is a local playground; the server does not provide authentication or durable AG-UI event replay.

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

The `get_current_time` tool provides a simple tool-call path. Aegra's native Agent Protocol stream is also available at `POST /runs/stream` on port `2026`.

## Develop and check

```sh
make check
make format
```

`make check` runs Pyrefly and TypeScript type checking, Ruff and ESLint linting, Ruff and Prettier format checks, Python tests, and the web build. `make format` applies the Python and frontend formatters. Individual targets such as `make typecheck`, `make lint`, `make format-check`, `make test`, and `make build` are available when a faster check is useful. Web linting checks Tailwind class names, including canonical forms such as `max-w-205`.

Pyrefly uses its strict preset. Ruff keeps its default checks and adds import sorting, common bug checks, and Python syntax upgrades; its formatter uses the default 88-character line length. Both TypeScript projects enable strict checking, unchecked index access, exact optional properties, and verbatim module syntax. ESLint uses the JavaScript and type-aware TypeScript recommended rules, with React Hooks rules for the web app. Prettier uses its defaults, while `.editorconfig` defines indentation and line endings for editors.

To include the PostgreSQL checkpoint test, start the Compose database and run `TEST_DATABASE_URL=postgresql://agent:agent@127.0.0.1:55432/agent_playground make test`.
