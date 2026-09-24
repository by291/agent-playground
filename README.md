# Agent playground

A small TypeScript runtime for trying LangChain agents with PostgreSQL checkpoints and AG-UI event streaming. It exposes one AG-UI compatible SSE endpoint and a health endpoint. PostgreSQL is the only Docker Compose service.

## Run locally

Requires Node.js 22+, pnpm, Docker, and an OpenAI API key or an OpenAI-compatible endpoint.

```sh
pnpm install
cp .env.example .env
docker compose up -d --wait
pnpm dev
```

Set `OPENAI_API_KEY` and `OPENAI_MODEL` in `.env` before starting the server. Set `OPENAI_BASE_URL` if you use a compatible provider. The API listens on `127.0.0.1:3000` by default, and Compose exposes PostgreSQL on `127.0.0.1:55432`.

## Send a run

```sh
curl --no-buffer -X POST http://127.0.0.1:3000/agent \
  -H 'Content-Type: application/json' \
  -H 'Accept: text/event-stream' \
  -d '{
    "threadId": "demo-thread",
    "runId": "demo-run-1",
    "messages": [{"id": "user-message-1", "role": "user", "content": "What time is it now?"}]
  }'
```

The response contains AG-UI `RUN_STARTED`, text message and tool call events, then `RUN_FINISHED` or `RUN_ERROR`. The built-in `get_current_time` tool gives the agent a simple tool-call path to exercise. `GET /health` returns `{"status":"ok"}`.

For another turn, keep `threadId` and use new `runId` and user message IDs. The runtime sends only the final user message to LangChain because the PostgreSQL checkpoint already contains earlier turns. It currently accepts text user messages and server-side tools only. Client tools, context, interrupt resume, and multimodal input are outside this first version.

## Check

```sh
pnpm typecheck
pnpm test
TEST_DATABASE_URL=postgresql://agent:agent@127.0.0.1:55432/agent_playground pnpm test
```

The last command includes a PostgreSQL test that creates a second agent instance and checks that it can continue an existing thread. It needs the Compose database to be running. The normal test command skips that test.
