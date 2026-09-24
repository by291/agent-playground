# Agent playground

A small monorepo for trying agent runtime ideas. The Python `agent_playground/` package defines a LangChain agent served by Aegra. The Hono `server/` exposes an AG-UI endpoint using the official remote LangGraph adapter. The React `web/` project is a chat and event viewer.

```text
web/ (AG-UI client) → server/ (AG-UI adapter) → Aegra run queue → agent_playground/
                                                ↘ PostgreSQL checkpoints
```

## Run locally

Requires Docker for PostgreSQL and Redis, plus uv, pnpm, and an OpenAI API key or compatible endpoint. The application processes run on the host for fast iteration.

```sh
cp .env.example .env
# Set OPENAI_API_KEY in .env.
docker compose up -d --wait
uv sync
pnpm install
```

Start each process in a separate terminal from the repository root:

```sh
uv run --env-file .env aegra serve --host 127.0.0.1 --port 2026
pnpm --filter agent-playground-server dev
pnpm --filter agent-playground-web dev
```

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
uv sync
pnpm install
uv run pytest
uv run ruff check .
pnpm check
pnpm build
pnpm format:check
```

To include the PostgreSQL checkpoint test, start the Compose database and run `TEST_DATABASE_URL=postgresql://agent:agent@127.0.0.1:55432/agent_playground uv run pytest`.
