# Observability

[Documentation index](README.md) · [Local development](development.md)

## Current scope

The application provides traces across its three layers, local Langfuse inspection, structured logs and basic HTTP/SSE/Aegra metrics. Compose's `observability` profile enables the supporting services on demand.

The trace path is browser `web.submit` → server HTTP span → `server.agent` → Python `agent.execute` → LangGraph model/tool/node spans. Each layer exports OTLP to the Collector, which forwards traces to Langfuse; Prometheus collects metrics for Grafana.

## Queue propagation

The server uses LangGraph SDK `onRequest` to write W3C Trace Context into HTTP headers and `config.metadata.otel_trace_context`. Aegra persists the run configuration, which Redis workers read when invoking the graph factory.

Python uses Aegra's supported context-manager factory to restore OTel context during execution and release it on exit. Model/tool tracing reuses Aegra's OpenInference instrumentation. This does not patch Aegra code, queues or tables. MCP definitions and model initialization use asynchronous caches; Aegra still copies the graph and injects its checkpointer per run.

For schema, checkpoint and conversation reads, the factory identifies non-execution requests through `runtime.execution_runtime` and does not create an `agent.execute` span.

## Identities and lifecycle

| Identity                       | Meaning                                 |
| ------------------------------ | --------------------------------------- |
| `trace_id`, `span_id`          | Telemetry trace and node.               |
| `thread_id` / Langfuse session | Conversation.                           |
| `agui_run_id`                  | Submission or review-resume submission. |
| `aegra_run_id`                 | Underlying execution.                   |

HTTP retries create new submission traces, while run identities correlate the same logical submission. Review pauses end the current execution; resuming starts a new trace. Browser disconnect ends client/SSE observation, while background execution retains its persisted parent context.

Server `app.stream.outcome` describes the stream connection rather than the durable Aegra run. `finished`, `interrupted`, `error` and `disconnected` are separate outcomes. HTTP response duration measures response establishment; SSE duration measures the connection lifetime.

Browser `app.first_text_received_ms` measures the first nonempty text delta, excluding Markdown rendering and animation delay. A2UI ingestion errors attach to the submission span; rendering errors use separate spans with a surface ID.

## Local startup

Set the Agent listener and telemetry in the private `agent.yaml` before starting:

```yaml
http:
  host: 0.0.0.0
  port: 2026
observability:
  targets: [GENERIC]
  otlp_endpoint: http://127.0.0.1:4318/v1/traces
  prometheus_metrics: true
```

Preserve the other sections in the complete file. The listener allows the Compose Prometheus service to scrape Aegra; the launcher converts telemetry settings into Aegra's required environment. Agent settings always come from YAML, including in observability mode.

```sh
make setup
# Set chat.models.deepseek.api_key in models.yaml.
make infra-up
# Stop managed apps before switching process modes.
make dev-stop
make dev-observability
```

Existing environments can skip setup; use [development](development.md) for configuration and restart instructions. `make infra-up` builds the Skill runtime and prepares sandbox images. Observability mode additionally enables its native Compose profile and server/Web telemetry. To stop Agent telemetry, clear `observability.targets`, disable `prometheus_metrics` and restart the Agent.

The first start downloads Langfuse, ClickHouse, MinIO, Collector, Prometheus and Grafana images. Langfuse uses separate PostgreSQL, Redis and data volumes.

| Service             | Address               | Local account                                         |
| ------------------- | --------------------- | ----------------------------------------------------- |
| Langfuse            | http://127.0.0.1:3031 | `developer@example.com` / `playground-local-password` |
| Grafana             | http://127.0.0.1:3032 | `developer` / `playground-local-password`             |
| Prometheus          | http://127.0.0.1:9091 | None.                                                 |
| Collector OTLP HTTP | http://127.0.0.1:4318 | Localhost only.                                       |

Langfuse initializes an `Agent Playground` project. Browser telemetry goes through same-origin `/telemetry/v1/traces`; the browser has no Langfuse keys. The frontend SDK loads dynamically when enabled.

Grafana loads the `Agent Playground` dashboard with target health, SSE outcomes/p95 duration and Collector queue/errors. Application startup is required to produce application metrics; with only infrastructure running, the Aegra scrape target may be unavailable.

Application processes run in the background with logs in `.dev/`. `make dev-stop` stops the three applications; `make infra-down` stops infrastructure, including observability.

Alternatively run `make observability-up`, `make agent-observability`, `make server-observability` and `make web-observability` separately. The Agent uses the YAML settings above; the server and Web read their own `.env`, and their commands supply local telemetry settings through process environment variables.

For manual Agent settings, `observability.otlp_endpoint` in `agent.yaml` includes `/v1/traces`; the server uses an OTLP base URL without that path. See [Agent configuration](agent-configuration.md) for trace targets and exporter keys. Set frontend `VITE_OBSERVABILITY_ENABLED=true`, restarting Vite after a change. Production builds require the flag at build time.

## Deployment boundaries

Compose contains development settings and default local accounts. Replace credentials and addresses for deployment and route `/telemetry` to the server. Scrape targets must use deployment service addresses; `host.docker.internal:2026` in local settings reaches host-run Aegra.

SDK export is batched, bounded and asynchronous. Collector failure does not block submission/execution, but full queues can drop telemetry. The business database remains authoritative for run data.

The TypeScript server owns one shutdown sequence for both application resources and telemetry. SIGINT/SIGTERM first stop live transports and workers, close shared notification subscriptions, then release object storage and PostgreSQL. Trace and metric providers flush last so cleanup work is included. Telemetry bootstrap does not send another termination signal.

Centralized log storage, host/PostgreSQL/Redis exporters, final run-status synchronization and business alerts are not integrated. Inspect terminal logs by trace ID; the server uses Pino and Python uses Aegra's structlog. Actual queue wait, first visible text and internal MCP stdio-process spans are not measured separately; LangChain instrumentation covers tool-call spans.

## Verification

`make check` includes context restoration, concurrency isolation, exception cleanup, browser propagation, server request adaptation and disconnected-stream tests using real PostgreSQL/Redis workers. Models are controlled; external models are not called. Starting Langfuse and verifying actual ingestion requires separate checks and cannot be inferred from unit tests.
