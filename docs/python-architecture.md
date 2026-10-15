# Python architecture

[Documentation index](README.md) · [System architecture](architecture.md) · [Agent configuration](agent-configuration.md)

Python owns agent execution, workflow orchestration and capability implementations. Aegra owns scheduling, checkpoints and the runtime memory Store; the TypeScript server owns conversation admission, recovery and file/document lifecycles. Python does not replace those owners with another execution or HTTP protocol.

## Packages and entries

| Path                                              | Responsibility                                                                                                                                                                          |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `graph.py`                                        | Assemble the conversation agent, discover MCP tools and select the graph for each persisted run model.                                                                                  |
| `context_state.py`, `context.py`                  | Checkpoint contracts, recoverable public responses, context usage and compaction middleware.                                                                                            |
| `planning.py`                                    | Adapt official task-planning middleware with bounded active-plan recall; reuse its tool, state schema and autonomous agent loop.                                                        |
| `interactions.py`                                | Adapt native human-in-the-loop review with tool approval policy, validated clarification questions and checked human answers.                                                            |
| `prompts.py`                                      | Main-agent instructions; its small local time/MCP setup functions stay beside graph assembly in `graph.py`.                                                                             |
| `models/catalog.py`                               | Resolve model choices and call-specific input/output budgets; expose credential-free choices.                                                                                           |
| `models/profiles.py`, `providers.py`, `tokens.py` | Verified/SDK capacities, provider request adaptation and context/token accounting.                                                                                                      |
| `config/agent.py`, `models.py`, `reader.py`       | Agent/model YAML schemas and cached reads, common YAML parsing/validation and sanitized errors.                                                                                         |
| `services/a2a/contracts.py`                       | Pure application collaboration state, roles, terminal states and stable request fingerprints. Official A2A protocol types remain SDK-owned.                                             |
| `workflows/<domain>/graph.py`                     | Business graphs beside their model calls, API clients, state and cards; common conversational review, external task waits and durable output publication live directly in `workflows/`. |
| `services/sql/`, `report/`, `a2a/`                | Demonstration APIs, asynchronous jobs and independent A2A agents/coordinator. `a2a/handler.py` adapts durable requests; `server.py` assembles the standalone agent server.              |
| `knowledge/`                                      | Document extraction, indexing, generation publication, embedding quotas and retrieval. `config.py` owns embedding identity/budgets; `store.py` owns scoped clients/pools.               |
| `memory/`                                         | Durable record policy, revision-safe writes/forgetting, bounded recall, tools, model middleware and private management routes.                                                          |
| `skills/`                                         | Bundle discovery, sandbox execution and authenticated conversation-file transfers. One execution scope owns its sandbox and cleanup.                                                    |
| `db/`                                             | Table declarations, cached engine lifecycle, cancellation-aware thread draining and persistence. The A2A SDK TaskStore keeps atomic reservation and replay together.                    |
| `app.py`, `cli.py`, `mcp_server.py`               | HTTP assembly/worker lifespan, Aegra command/environment adapter and standalone stdio MCP entry.                                                                                        |
| `observability.py`                                | Per-execution trace propagation and restoration, independent of capability implementations.                                                                                             |

`aegra.json` loads `graph.py:graph` and `app.py:app`. The `agent` command remains `agent_playground.cli:main`; the standalone A2A command remains `python -m agent_playground.services.a2a.server`.

The root graph contains the actual factory and execution context. The experiment, SQL, report and A2A business graphs live in `workflows/experiment/graph.py`, `workflows/sql/graph.py`, `workflows/report/graph.py` and `workflows/a2a/graph.py`. Keep these entries easy to locate. A2A's contract module lives beside its owning service in `services/a2a/contracts.py` and is directly available to persistence and workflow clients.

## Dependency direction

Entries compose capabilities. The conversation graph consumes workflow tools, context middleware, memory, knowledge and Skills. Workflows may use service API models, but services do not import workflow orchestration. Database modules may import the pure `services/a2a/contracts.py` module for collaboration state and retry identity. That module has no application dependencies; database imports of other service modules remain prohibited by architecture checks.

Configuration schemas depend on model profiles to validate declared capacities; profile inspection never constructs provider clients. The model catalog consumes configuration and token budgets without importing the conversation graph or middleware. Memory's conversation adapter consumes checkpoint state and token accounting; memory contracts and record operations remain independent of conversation execution.

Package initializers contain only package documentation. Import modules from their actual owner rather than creating compatibility barrels that hide dependency direction. `tests/test_module_boundaries.py` checks imports, cycles, lightweight initializers and Aegra entry resolution.

## State and resource lifetimes

- Preserve graph node names, tool names, checkpoint fields and stable publication identities. Splitting files changes code ownership without changing those persisted contracts.
- Context middleware keeps `response_messages` separate from model history before compaction, preserving public replies and tool results through review/recovery. Token accounting includes provider reasoning replay and reserves fixed prompt/tool/memory budgets.
- Planning keeps official `todos` state separate from summarized messages. Its bounded active-plan reference is included in model context and token accounting; successful tool messages preserve plan history for both clients.
- Interactions use the official checkpointed approval/response lifecycle. Each approval permits one displayed operation; clarification answers match the requested IDs before becoming successful tool results. Private policy snapshots keep pending review identity stable across graph recreation; policy updates apply at the next model boundary. MCP tools cannot replace reserved clarification or plan-bookkeeping names. Business workflows retain their existing review owners.
- Workflow output publication saves before live emission. Retry identities and output sequences are durable; cards only describe presentation and do not archive conversation messages.
- Repository operations keep existing validation/lock/read/write order. A2A task terminal states, coordinator leases, knowledge generations and memory revisions protect against stale or replayed writes.
- The application lifespan prepares schema before starting workers, drains workers before disposing the cached engine, and releases the engine even after cancelled startup. `run_database_operation` drains its database thread before propagating cancellation; do not replace unrelated `to_thread` calls without evaluating their cancellation contract.
- Store/client and sandbox scopes release resources in context managers or `finally`. A2A request adaptation keeps dispatch and subscription cleanup together, while standalone app assembly owns its process lifespan.

## Readability and verification

Follow the Python conventions in [AGENTS.md](../AGENTS.md#python-modules-flows-and-resources). Keep the main flow visible through logical stages, descriptive guards and focused local helpers. Add docstrings/comments where a future change could break a protocol invariant, revision, retry or resource lifetime; formatting alone cannot explain those decisions.

Run `uv run ruff check .`, `uv run ruff format --check .`, `uv run pyrefly check` and `uv run pytest` for Python structural changes. PostgreSQL/Redis integration tests create isolated Testcontainers services and databases. Test runners that directly use asynchronous Psycopg on Windows select a compatible loop locally; they do not change the process-wide policy used by subprocess clients. Browser regression uses the real Python HTTP application and verifies route/worker integration alongside the TypeScript server.
