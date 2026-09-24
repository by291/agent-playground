# Agent playground

A small Python LangChain agent served by Aegra. Aegra provides Agent Protocol APIs for threads, runs, and PostgreSQL checkpoints. A custom route uses the official `ag-ui-langgraph` adapter to stream AG-UI events from the same agent graph.

## Run locally

Requires Docker and an OpenAI API key (or an OpenAI-compatible endpoint).

```sh
cp .env.example .env
# Set OPENAI_API_KEY in .env.
docker compose up --build -d --wait
```

The API listens on `http://127.0.0.1:2026`. PostgreSQL is exposed on `127.0.0.1:55432` for local inspection. Redis is internal to Compose. Set `OPENAI_BASE_URL` to use a compatible provider.

## Stream AG-UI

```sh
curl --no-buffer -X POST http://127.0.0.1:2026/agent \
  -H 'Content-Type: application/json' \
  -H 'Accept: text/event-stream' \
  -d '{
    "threadId": "demo-thread",
    "runId": "demo-run-1",
    "messages": [{"id": "user-message-1", "role": "user", "content": "What time is it now?"}],
    "tools": [],
    "context": [],
    "state": {}
  }'
```

The stream is encoded by `ag-ui-langgraph`. The `get_current_time` tool provides a simple tool-call path. The AG-UI route borrows Aegra's graph and PostgreSQL checkpointer. It streams directly from the API process, while Agent Protocol runs use Aegra's run queue. For this playground, keep AG-UI and Agent Protocol thread IDs separate; the direct AG-UI route does not use Aegra's run queue or its per-thread concurrency controls.

## Agent Protocol

```sh
curl --no-buffer -X POST http://127.0.0.1:2026/runs/stream \
  -H 'Content-Type: application/json' \
  -d '{
    "assistant_id": "agent",
    "input": {"messages": [{"role": "user", "content": "Hello"}]},
    "stream_mode": "messages-tuple"
  }'
```

`GET /health` checks the Aegra server.

## Develop and check

```sh
uv sync
uv run pytest
uv run ruff check .
```

To include the PostgreSQL checkpoint test, start the Compose database and run `TEST_DATABASE_URL=postgresql://agent:agent@127.0.0.1:55432/agent_playground uv run pytest`.

Use `docker compose up -d postgres redis` when running the Python server on the host. Then set `DATABASE_URL=postgresql://agent:agent@127.0.0.1:55432/agent_playground` and run `uv run aegra serve`.
