# Agent playground

An evolving agent application for validating runtime capabilities and strengthening engineering foundations toward production use. A Python LangChain agent runs through Aegra; the Hono server adapts AG-UI and manages durable conversations; the React and native Android clients provide chat, workflow review and A2UI rendering.

```text
React web / Android Compose → Hono / AG-UI adapter → Aegra execution queue → Python agent
                    ↘ Application PostgreSQL / S3          ↘ Docker Skills
```

## Quick start

Requires Docker, uv, pnpm, Node.js, Make and a DeepSeek API key. See [local development](docs/development.md) for versions, environment ownership and troubleshooting.

```sh
make setup
# Set DEEPSEEK_API_KEY in the root .env created by setup.
make dev
```

Open <http://127.0.0.1:5173>. The agent, server and web app run in the background; logs are in `.dev/`. The default infrastructure includes PostgreSQL with pgvector, Redis, OpenSandbox and SeaweedFS S3. Configure an independent embedding API in the root `.env` before indexing knowledge documents.

```sh
make dev-stop
make infra-down
```

A native Jetpack Compose client is available in [`android/`](android/README.md). Open it in Android Studio and connect to the same TypeScript server on port 3000; its guide covers SDK requirements, emulator/device addresses and independent Android checks.

## Capabilities

| Capability        | Behavior and guide                                                                                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Conversations     | Streaming Markdown/reasoning, persisted history, review recovery and automatic context compaction. Thread IDs are allocated on the first valid submission. [Guide](docs/conversations.md). |
| Workflows         | Experiment-plan approval, conversational SQL review and asynchronous reports that continue without an open browser. [Guide](docs/workflow-mechanisms.md).                                  |
| Shared knowledge  | Upload documents for retrieval across conversations; inline footnotes open the exact retrieved passage. Shared-document deletion requires confirmation. [Guide](docs/knowledge.md).        |
| Agent Skills      | Published `SKILL.md` bundles, Python/Bash/Node scripts in Docker, chat attachments and downloadable outputs. [Guide](docs/skills.md).                                                      |
| Development tools | Live protocol Activity and an A2UI/Monaco component gallery, excluded from production builds. [Guide](docs/frontend-architecture.md#components-and-development-tools).                     |
| Observability     | Optional traces, Langfuse, Collector, Prometheus and Grafana. [Guide](docs/observability.md).                                                                                              |

## Documentation and code

Use the [documentation index](docs/README.md) to find setup, feature guides, architecture and historical records. [AGENTS.md](AGENTS.md) contains contribution and code-style rules.

| Directory                  | Purpose                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `agent_playground/`        | Python agent, workflows, demonstration APIs, Skills and knowledge indexing/retrieval. |
| `server/`                  | AG-UI/HTTP adaptation, conversation lifecycle, persistence and shared S3 storage.     |
| `web/`                     | React pages, conversation/knowledge UI and A2UI runtime/catalog.                      |
| `android/`                 | Native Compose client, JVM protocol/session core and Android tests.                   |
| `shared/`                  | TypeScript application contracts; protocol types come from official libraries.        |
| `skills/`                  | Maintainer-published Skill bundles and their scripts/resources.                       |
| `infra/`, `compose.yaml`   | Local infrastructure and Skill runtime image.                                         |
| `tests/`, `web/tests/e2e/` | Python checks and browser regression/live smoke.                                      |

## Validation

```sh
make check
pnpm test:e2e
```

`make check` runs types, lint, formatting, tests and the web build. Database/browser tests require Docker and own isolated temporary services. Browser regression uses controlled Aegra/embedding responses; [live smoke](web/tests/e2e/README.md#live-smoke) separately validates the running Python agent and configured model.

The application currently uses a shared workspace without user authentication or tenant ownership, and recovers persisted results without durable AG-UI event replay. SQL/report services are demonstrations; SQL is never executed. Feature guides describe further limits. Compose provides local development configuration, not a complete production deployment.
