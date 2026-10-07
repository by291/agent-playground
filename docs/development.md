# Local development

[Documentation index](README.md) · [Architecture](architecture.md)

## Prerequisites and first start

Use Docker with a running daemon, Python 3.12 with uv, pnpm, Node.js and Make. The repository declares its pnpm version in [package.json](../package.json); CI uses Node.js 26 and Python 3.12. A DeepSeek API key is needed for live agent conversations. Tests with controlled models do not need that key.

The same Make targets work in PowerShell and CMD on Windows with native GNU Make. Keep Node.js, uv, pnpm and Docker on `PATH`; Git Bash is not required. Use Docker Desktop with Linux containers. Make selects CMD for Windows recipes and `gradlew.bat` for Android targets, while the Node scripts handle environment-file creation and application launch settings.

`.gitattributes` checks out text files with LF on every platform, reserving CRLF for Windows batch scripts. Prettier keeps its normal LF checks. Existing Windows checkouts that already contain CRLF can run `pnpm format` once to normalize the formatted sources; future checkouts use the repository attributes.

```sh
make setup
# Set DEEPSEEK_API_KEY in the root .env created by setup.
make dev
```

Open <http://127.0.0.1:5173>. `make dev` builds the Skill runtime image, prepares OpenSandbox sidecar images, waits for Compose infrastructure and starts three application processes plus two independent A2A agents. Logs and process IDs live in `.dev/`; child agent logs are in `.dev/a2a/`:

```sh
tail -f .dev/agent.log .dev/server.log .dev/web.log
make dev-stop
make infra-down
```

In PowerShell, follow a log with `Get-Content .dev/agent.log -Tail 50 -Wait`.

If Windows reports that an application control policy blocked a Python DLL or executable, inspect Windows Security's Smart App Control settings and `Microsoft-Windows-CodeIntegrity/Operational` events to identify the blocked file and active policy.

Stop the applications before infrastructure so active execution can release its resources. `make dev-stop` stops the managed applications; `make infra-down` stops the project infrastructure, including optional observability services. Data volumes remain unless explicitly removed.

On Linux and macOS, managed applications receive `SIGTERM`. Windows stops each managed process tree with `taskkill /T /F`, which forces termination; finish active work before stopping it. The launcher waits for the managed processes to exit before deleting their journal. If cleanup fails, the journal remains available for another `make dev-stop` attempt.

For separate terminals, run `make infra-up` once, then run each of `make agent`, `make server` and `make web` in its own terminal. `make help` lists all shortcuts.

After Python agent, prompt, Skill or root environment changes, restart the agent. To restart the managed applications with already-running infrastructure:

```sh
make dev-stop
node scripts/dev.mjs start
```

To enable tracing, prepare the normal infrastructure and use the [observability guide](observability.md). Changing between normal and observability process modes requires `make dev-stop` first.

## Services and local ports

Application processes run on the host; supporting services run in Docker. Skills are included in the default Compose startup.

| Service      | Local endpoint          | Purpose                                                       |
| ------------ | ----------------------- | ------------------------------------------------------------- |
| Vite         | `http://127.0.0.1:5173` | Web UI and API proxy.                                         |
| Hono server  | `http://127.0.0.1:3000` | `POST /agent`, conversations, files and document APIs.        |
| Aegra        | `http://127.0.0.1:2026` | Python agent and native Agent Protocol; SQL/report demo APIs. |
| A2A planner  | `http://127.0.0.1:2031` | Independent planning/revision agent.                          |
| A2A reviewer | `http://127.0.0.1:2032` | Independent proposal review agent.                            |
| PostgreSQL   | `127.0.0.1:55432`       | Application tables, Aegra state and pgvector chunks.          |
| Redis        | `127.0.0.1:56379`       | Aegra broker and execution queue.                             |
| OpenSandbox  | `http://127.0.0.1:8080` | Skill execution control API.                                  |
| SeaweedFS S3 | `http://127.0.0.1:8333` | Local persistent input, output and document objects.          |

These defaults come from [compose.yaml](../compose.yaml) and the three environment examples. OpenSandbox's dynamic execution ports are also configured to publish on loopback; see [Skills](skills.md).

## Environment ownership

`make setup` creates missing environment files without replacing existing ones. Each application reads its own file; all three are ignored by Git. When updating an existing checkout, merge new settings from the matching example rather than expecting setup to update them automatically.

| File          | Settings                                                                                          | Source                                        |
| ------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Root `.env`   | DeepSeek, Aegra, database/broker, internal application URL/token, Skill execution and embeddings. | [.env.example](../.env.example)               |
| `server/.env` | Hono/Aegra addresses, application database, internal token, S3 and logging.                       | [server/.env.example](../server/.env.example) |
| `web/.env`    | Vite's `BACKEND_URL` and browser tracing flag.                                                    | [web/.env.example](../web/.env.example)       |

`make setup` uses `scripts/setup-env.mjs` to copy missing environment files from their matching examples and generate the same random `WORKFLOW_API_TOKEN` in the root and server environment files. Existing files and configured tokens are preserved. For an existing checkout:

```sh
node scripts/setup-env.mjs
```

Conflicting existing tokens are rejected. Internal external-task registration, Skill transfers and knowledge downloads share this credential; the browser does not receive it.

The chat model uses `ChatDeepSeek` and defaults to `deepseek-flash`. Configure `DEEPSEEK_API_KEY`, optionally `DEEPSEEK_MODEL` and a custom `DEEPSEEK_API_BASE`, in the root environment. Older `OPENAI_*` chat settings must be replaced with the DeepSeek settings. Embeddings are independently configured in the [knowledge guide](knowledge.md).

`APP_API_URL` is the Python-to-TypeScript base URL, defaulting to `http://127.0.0.1:3000`. It replaced `WORKFLOW_API_URL`; update existing environment files. `SQL_DEMO_API_URL` and `REPORT_DEMO_API_URL` point to the Python demonstration services if Aegra uses another address. Vite's `BACKEND_URL` must point to the Hono server.

`make dev` also starts the independent A2A planner/reviewer services. The [A2A guide](a2a-demo.md) documents their root configuration, scripted mode, additional-input/cancel controls and recovery limits. `make a2a` starts only those services; they share the Python application's root environment and application database.

## S3-compatible storage

The server owns a single S3 client for conversation attachments, Skill outputs and knowledge originals. PostgreSQL stores their metadata and lifecycle state; file contents live in S3. Local Compose uses SeaweedFS and creates the `agent-skills` bucket. Its local development credentials are in [infra/skills/s3.json](../infra/skills/s3.json).

For another S3-compatible service, configure these settings in `server/.env` and create the bucket before use:

```dotenv
S3_ENDPOINT=https://storage.example.com
S3_BUCKET=agent-playground
S3_REGION=us-east-1
S3_FORCE_PATH_STYLE=true
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
```

The AWS SDK uses its standard credential chain, including an optional `AWS_SESSION_TOKEN` or deployment role. `S3_ENDPOINT` is optional when using AWS S3; set path-style access according to the service. The old `SKILL_S3_*` names have been replaced by `S3_*`. Knowledge cleanup needs list, get, put and delete permissions; credentials remain on the server and are not passed to the browser or scripts.

## Database and data ownership

| Store                                     | Owner and contents                                                                                                                                                                        |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL `aegra` schema                 | Aegra service tables, Alembic history, checkpoints and store; root `DATABASE_URL` uses the `aegra` role.                                                                                  |
| PostgreSQL `public` schema                | Conversation runs/messages, workflow outputs, demo receipts/jobs, file/document metadata and pgvector chunks; each application has its own `APP_DATABASE_URL` using the application role. |
| S3 / `skill_storage_data` volume          | Original documents, conversation inputs and published script outputs.                                                                                                                     |
| OpenSandbox / `skill_sandbox_data` volume | Control-service state; execution workspaces expire and are not conversation storage.                                                                                                      |

The TypeScript server applies Drizzle migrations at startup. Python prepares its application repositories, while Aegra manages its own schema. Compose initializes the local `aegra` role and its search path only when creating a new PostgreSQL volume.

PostgreSQL 18 stores volume data at `/var/lib/postgresql`. An older PostgreSQL 17 volume cannot be reused directly. `docker compose down --volumes` removes **all volumes in this Compose project**, including PostgreSQL, local S3 objects and sandbox state; use it only when intentionally discarding that local data. It is not a normal restart or upgrade step.

## Quality checks

Run commands from the repository root:

| Command                                            | Scope                                                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `make check`                                       | Python/TS types, lint, format checks, Python/server/web and dev-script tests, web build.         |
| `make typecheck`, `make lint`, `make format-check` | Focused static checks.                                                                           |
| `make format`                                      | Apply Ruff and Prettier formatting.                                                              |
| `make test`                                        | Python, server/web Vitest and development-script tests.                                          |
| `make build`                                       | Type checking and production web build.                                                          |
| `pnpm test:e2e`                                    | Controlled browser regression, separately from `make check`.                                     |
| `pnpm test:e2e:live`                               | Live stack/model smoke; requires an explicit `E2E_BASE_URL`.                                     |
| `make skills-smoke`                                | Actual Docker scripts, sandbox file I/O, network policy and cleanup; needs local infrastructure. |

Database tests own temporary Testcontainers resources and need Docker. They do not use the daily Compose database or require `TEST_DATABASE_URL`. Python database tests share one container with a fresh database per test; server integration tests share one project container with a fresh database per file. The Python worker tracing test owns separate PostgreSQL and Redis containers. Tests release connections before dropping databases.

`pnpm test:dev` runs the development-tool regression tests without Docker or model credentials. They cover environment setup, native Android wrapper selection, command launch and process-tree cleanup with temporary files and processes. CI runs these tests on Linux and Windows.

TypeScript uses Vitest: server/pure logic tests use Node, and frontend DOM tests opt into jsdom. Frontend shared setup cleans up components, storage, theme, mocks and timers. Shared web tests reuse worker environments; App route tests run in a separate isolated project because they alter import-time configuration. Check order independence when changing shared test state:

```sh
pnpm --filter agent-playground-web exec vitest run --maxWorkers 1 --sequence.shuffle --sequence.seed 104
pnpm --filter agent-playground-server test:unit
pnpm --filter agent-playground-server test:integration
pnpm --filter agent-playground-server test:watch
pnpm --filter agent-playground-web test:watch
pnpm test:coverage
```

Repeat the shuffled run with another seed if shared state changed. Unit/watch server commands exclude Docker integration tests. Coverage uses V8 and writes HTML/LCOV under `server/coverage/` and `web/coverage/`. Browser commands, reports, CI behavior and fixture ownership are documented in the [browser guide](../web/tests/e2e/README.md).

GitHub Actions runs Python, server and web tests on both Linux and Windows for pull requests and pushes to `main`, cancelling superseded runs. Windows runs Python tests with `uv run pytest -m "not integration"`, server unit tests, development-tool tests and the web tests/build. Python tests using container fixtures are marked `integration`; tests that create their own containers declare the marker explicitly. A symlink-specific test skips only when the Windows account lacks symlink privileges; metadata validation still runs independently.

Linux additionally runs all Python/server container integration tests, full browser E2E, static formatting checks and Android verification. The PostgreSQL/Redis/S3 images require a Linux Docker daemon; the hosted Windows jobs do not provision one. Native Windows browser E2E remains available locally with Docker Desktop in Linux-container mode. Formatting and strict code conventions are defined in [AGENTS.md](../AGENTS.md) and the checked-in tool configuration.

## Dependency updates

[Dependabot](../.github/dependabot.yml) checks for version updates every Monday at 09:00 in `Asia/Shanghai`. Its configuration takes effect when it reaches the repository's default branch. It covers the root pnpm workspace and lockfile, Python's `pyproject.toml` and `uv.lock`, Android's Gradle builds/version catalog/wrapper, GitHub Actions, both Compose manifests and the Skill runtime Dockerfile's base image. Packages installed directly by `RUN pip install` or `apt-get` in the Dockerfile need manual maintenance.

Minor and patch releases are grouped by ecosystem, while major releases get separate pull requests. Each ecosystem has a limit of three open version-update pull requests. Updates use `chore:` commit titles and run the existing pull-request CI; review and merge them after the relevant checks pass. Container updates also need checks against the affected local service or Skill runtime because CI does not exercise every Compose service.

`yet-another-react-lightbox` is excluded from automatic updates while its version-specific [pnpm patch](../patches/yet-another-react-lightbox@3.32.2.patch) is needed. Upgrade it manually, rebase or remove the patch, and run the image gesture regressions in `web/tests/e2e/regression/images.spec.ts`. Remove the exclusion when the upstream release contains the required fixes. Keep both YAML documents in the pnpm lockfile when updating the workspace with pnpm 12.

Version updates do not enable Dependabot security alerts or security updates. Those settings are managed separately in GitHub's repository security settings; see the [Dependabot setup guide](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/configure-version-updates).

## Troubleshooting

| Symptom                                 | Check                                                                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Compose or Testcontainers cannot start  | Docker daemon availability, image downloads and occupied ports. Check `docker compose ps`.                                                  |
| UI reports an offline gateway           | `.dev/server.log`, server `/health`, `web/.env` proxy target and Aegra address.                                                             |
| Internal file/task requests fail        | Root and server `WORKFLOW_API_TOKEN` match; `APP_API_URL` points to the running server.                                                     |
| Attachments or document uploads fail    | Server S3 settings, bucket existence and object permissions; local `skill-storage` health.                                                  |
| Indexing fails with `BadRequestError`   | Embedding base URL/model, provider batch limit and unsupported `dimensions`; see [knowledge troubleshooting](knowledge.md#troubleshooting). |
| Changes do not affect agent behavior    | Restart the agent after prompt, Skill or root environment edits.                                                                            |
| Submission remains `submission_unknown` | Mapping recovery cannot establish the upstream run; do not blindly resend. See [conversation recovery](conversations.md#recovery).          |

The application currently uses a shared workspace without user authentication or tenant ownership. Compose credentials and host bindings are local-development configuration; deployment requires its own access controls, credentials and network setup.
