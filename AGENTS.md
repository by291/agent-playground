# Project rules

## Project goals

- This is an evolving agent application. It validates agent runtime capabilities while strengthening engineering discipline toward production use.
- Keep responsibilities clear, state models understandable and behavior covered by regression checks. Changes to execution, recovery and persistence should prioritize consistency and resource lifecycles. Evolve from actual requirements rather than introducing complexity without evidence.
- Once key requirements affecting implementation are clear, proceed directly. Select design and verification steps appropriate to the change; a fixed process is not required.

## Repository navigation

- `agent_playground/`: Python agent, tools and MCP, served through Aegra's Agent Protocol. `skills/` discovers published bundles, executes sandboxed scripts and transfers files. `workflows/` groups graphs, tool entries and cards by business domain; SQL state/contracts, model calls and API clients are separate. `workflows/review.py` owns common conversational review; `workflows/external.py` registers and waits for external tasks; `workflows/output.py` publishes outputs and reply/presentation metadata. The conversation layer uses these contracts for feedback, archiving and presentation ownership; business cards do not archive messages. `knowledge/` owns extraction, embeddings, background indexing and retrieval; the TypeScript server owns file/document lifecycles. `memory/` owns durable memory policy/tools, bounded recall and private management routes using the runtime Store. `services/sql/` contains demo API models, routes and checks; `services/report/` contains the asynchronous report API and background callbacks. Services do not depend on workflows; SQL workflows reuse service API models. `config.py` reads and validates private `agent.yaml` and `models.yaml` settings; `cli.py` translates YAML into the environment required by Aegra startup. Agent settings are not overridden by inherited environment values. `models.py` owns the conversation model catalog and resolved input/output budgets; `model_profiles.py` normalizes verified and SDK model information; `model_adapters.py` owns provider construction and reasoning-history replay. `db/` owns database contracts, connections, workflow outputs and demo-service persistence, independent of HTTP requests and exceptions.
- `server/`: TypeScript backend. `http/` owns routes, request validation and conversation-change SSE. `app.ts` assembles HTTP; `server.ts` owns process/resource lifecycles. `agent/` adapts Aegra and AG-UI. `conversation/` owns runs, recovery, persistent external tasks, background continuation, change notifications and conversation-file S3 lifecycles. `knowledge/` owns shared-document operations and cleanup; `memory/` proxies authenticated Python memory management; `storage/` contains the common Skill/knowledge object-storage client. `db/` owns application data. Application/process entries and configuration remain at the project root.
- `web/`: TypeScript frontend. `src/app/` owns entries, routes, configuration and global providers; `src/pages/` composes pages and owns development previews; `src/features/` groups APIs, models, runtime and UI by conversation, A2UI, knowledge and memory capability. `src/components/ui/` holds shadcn/ui primitives; `src/styles/` holds theme and global styles.
- `android/`: Native Jetpack Compose client. `app/` owns entry points, dependency assembly, navigation and Android lifecycle. JVM `core/` separates application models, protocol/transport, conversation state/recovery and pure presentation. Android `data/` owns repositories, preferences/journals and file access; `ui/` owns shared Compose design and system permission bridges. `feature/` separates conversation (including workflow rendering), knowledge, memory and settings UI/state. Reuse the existing TypeScript backend and keep agent execution on the server. See `android/AGENTS.md` for Kotlin and Android verification conventions.
- `shared/`: TypeScript application contracts for runs, conversations, context, workflow review/output, external tasks, files, knowledge and memory. Use official library types for AG-UI and A2UI.
- `compose.yaml`: Local PostgreSQL, Redis and other infrastructure. `tests/`: Python tests.
- `skills/`: Maintainer-published Skill bundles. `docs/`: Current development, capability and architecture guides, plus explicitly dated validation records.
- See [README.md](README.md) for the quick start and [docs/README.md](docs/README.md) for detailed guides. Do not duplicate changing feature status in this file.

## Implementation conventions

- Keep agent logic in Python, protocol/HTTP adaptation in `server/`, and interaction/presentation in `web/`. Confirm each layer's responsibility before changing a cross-layer path.
- Prefer existing library/protocol types, models and adapters over handwritten AG-UI or A2UI implementations.
- Use uv for Python and pnpm for TypeScript. Add/remove dependencies through the package manager and update lockfiles. Introduce libraries or infrastructure only when the verification or implementation requires them.
- Maintain infrastructure through Docker Compose. The Python Agent reads private root `agent.yaml` and `models.yaml`; the TypeScript server and Web read their own `.env`. Do not read another layer's configuration file. Export YAML settings before native Aegra startup; its CLI's dotenv loading preserves those values.
- Write code for human readers, with clear names and direct structure. Comment on intent, boundaries or non-obvious behavior; do not make files primarily comments.
- Frontend dependencies flow from app to pages, features and foundations. Cross-feature imports use public entries; currently only conversation may depend on A2UI. Feature internals import their own modules directly rather than using their public barrel and creating cycles. Colocate tests with implementation; browser flows belong in `web/tests/e2e/`.
- Conversation owns run-state writes. Recovery observations must not overwrite newer mappings or terminal states. Separate snapshot reads from upstream synchronization. Frontend Query fetches/delivers data, session coordinates state, and resource creators explicitly release resources.

## Code style and readability

Follow the control-flow and function-layout guidance in the [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html#control-flow-statements-and-blocks) and the logical grouping in [PEP 8](https://peps.python.org/pep-0008/#blank-lines). The project requirements below take precedence; TypeScript does not use the guide's single-line `if` exception.

- Always use braces for TypeScript `if`, `else`, `for`, `while` and `do`, with statements on separate lines, even for a single `return`, `throw` or `continue`. Do not use `if (condition) return value;` or multiline branches without braces.
- Python branches, loops and exception handlers also place statements on separate lines. Do not use `if condition: return value` or join statements with semicolons.
- Group function bodies by logical stages, such as validation, preparation, execution/persistence and response construction. Separate stages with a blank line; related declarations or operations can stay together. Avoid both a blank line after every statement and an unbroken multistage body.
- In TypeScript, add a blank line after declaration groups, before/after control-flow blocks and before the final `return`. A block containing one statement needs no extra internal blank lines. Separate functions/methods with a blank line. In Python, use two blank lines between module-level functions/classes and one between methods.
- Simple ternaries and single-expression arrow functions are acceptable; nested ternaries are not. Expand multiple checks, assignments or side effects into branches or named functions.
- Use domain names for variables/functions. Extract complex conditions into named variables so readers do not decode conditions, state and side effects at once. Do not add abstractions solely to shorten the code.
- Comments explain intent, protocol boundaries, races and non-obvious handling rather than restating code. Put necessary comments beside the relevant logical group.
- Prettier and Ruff handle indentation, wrapping and basic formatting. `.gitattributes` keeps text files at LF on every platform, with CRLF reserved for Windows batch scripts. `eslint.style.mjs` enforces TypeScript braces, nested-ternary restrictions and statement spacing. Automated formatting does not replace manual review of logical grouping. Source and tests follow the same rules; generated third-party database snapshots retain generated formatting.

## Development and verification

- `make help` lists shortcuts; `make setup` prepares dependencies/environment files; `make dev` starts local development.
- Run checks relevant to each change. Use `make check` for cross-project paths when appropriate. PostgreSQL tests in `make test` and `make check` use Testcontainers and require a Docker daemon.
- TypeScript unit, integration and DOM tests use Vitest. Pure logic/server tests use Node; frontend DOM files declare `@vitest-environment jsdom`. Shared frontend setup cleans DOM and restores mocks/timers. Name PostgreSQL server tests `*.integration.test.ts` so they can run separately.
- Browser E2E uses Playwright Test in `web/tests/e2e/`. Controlled regression uses temporary PostgreSQL, the real TypeScript backend and an Aegra HTTP fixture; live-model smoke separately connects to the existing development stack. Creators release test services/resources; do not reuse the daily development database.
- Update the relevant current guide in `docs/` when operation, environment, public behavior or limits change. Update `README.md` and `docs/README.md` when entry points/navigation change. Update this file when stable conventions or responsibilities change. Dated validation retains its original conclusions. Completed design/implementation plans may be removed after their relevant contracts and constraints are consolidated in current guides.

## Language and commits

- Use English for project documentation, code/comments, tests, custom configuration text, UI copy and Git commit messages.
- Commit titles use `type: short description`, such as `feat: add experiment entry point`. Choose `feat`, `fix`, `docs`, `refactor`, `test` or `chore` as appropriate; describe the change specifically rather than using vague titles such as `update`.
