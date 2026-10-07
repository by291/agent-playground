# Documentation

The guides below describe the current implementation. Start with [local development](development.md) to run the project, then choose a capability or architecture guide.

## Run and use

| Guide                                  | Contents                                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [Local development](development.md)    | Setup, environment ownership, services, S3, database migrations, checks and troubleshooting.     |
| [Android client](../android/README.md) | Native setup, feature mapping, architecture, HTTP/SSE recovery and Android checks.               |
| [Conversations](conversations.md)      | First submission, history, recovery, tools, preferences and context compaction.                  |
| [Workflows](workflow-mechanisms.md)    | Experiment, SQL and report examples; common review, durable output and external-task mechanisms. |
| [A2A collaboration](a2a-demo.md)       | Independent planner/reviewer agents, streaming child output, multi-turn input, cancellation and recovery. |
| [Shared knowledge](knowledge.md)       | Document upload, OpenAI-compatible embeddings, indexing, source citations and cleanup.           |
| [Agent Skills](skills.md)              | Published bundles, Docker execution, attachments, outputs and runtime limits.                    |
| [Observability](observability.md)      | Optional tracing, Langfuse, metrics, local accounts and deployment settings.                     |

## Develop and validate

| Guide                                             | Contents                                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [Architecture](architecture.md)                   | Python, server and web boundaries; storage, protocols and recovery consistency.      |
| [Frontend architecture](frontend-architecture.md) | Imports, state ownership, UI resources, development tools and frontend validation.   |
| [Browser tests](../web/tests/e2e/README.md)       | Controlled regression, live smoke, fixtures, coverage ownership and runtime reports. |
| [Project rules](../AGENTS.md)                     | Long-term directory, implementation, style and contribution conventions.             |

## Validation records

The [conversation recovery validation record](conversation-recovery-validation.md) preserves dated checks and their limitations. Its test counts, routes and formats belong to those runs rather than the current implementation. Current contracts and architecture decisions live in the guides above; completed implementation plans have been removed.

## Maintaining documentation

- Keep the root [README](../README.md) focused on the quick start, capability overview and links.
- Put setup and shared environment settings in `development.md`; keep capability-specific behavior in its guide.
- Update current guides when behavior changes. Use `AGENTS.md` for stable rules, rather than duplicating the current feature list there.
- Keep implemented contracts and constraints in current guides. Completed plans can be removed after that information is consolidated. Dated validation retains its original conclusions, distinguishing document checks, controlled tests and live-model validation.
