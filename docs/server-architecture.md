# Server architecture

[Documentation index](README.md) · [Architecture](architecture.md) · [Frontend architecture](frontend-architecture.md)

The server uses concrete capability names. Source lives in `server/src`; package scripts, tooling configuration, SQL migrations and reusable test harnesses stay at the package root. HTTP adaptation remains separate from execution and persistence.

## Structure

```text
server/
  src/
    app.ts                    Hono route assembly
    main.ts                   Startup, workers, signals and resource shutdown
    routes/                   Validation, response mapping, HTTP/SSE transport
    middleware/               Workflow authentication and request observation
    agent/                    Aegra client, review adapter, events and checkpoint messages
    conversation/
      runs/
        run-admission.ts      Serialized admission, retry identity and initial persistence
        run-store.ts          Run mapping, observations and process-local dispatch ownership
        run-dispatch.ts       Prepare and execute admitted runs
        run-recovery.ts       Reconcile upstream observations with persisted runs
        checkpoint-sync.ts    Persist checkpoint messages, interrupts and outputs
        model-validation.ts   Validate application model selection
        model-selection.ts    Persist a conversation's selected model
        review-validation.ts  Validate review and external continuation inputs
      history/                Listing, management, titles and snapshot reads
      tasks/                  External task persistence, scanning and continuation worker
      files/                  Skill files, input images, previews and cleanup
      events/                 PostgreSQL notifications and shared subscriptions
      errors.ts               Conversation operation failures
    knowledge/                Shared document persistence and cleanup
    memory/                   Bounded proxy to Python memory management
    db/                       Database connections and table schemas
    storage/                  Shared object-storage client
    observability/            Logging, traces, metrics and telemetry bootstrap
  drizzle/                    Committed SQL migrations and generated snapshots
  tests/                      Disposable PostgreSQL/S3 helpers and E2E upstream fixtures
```

`routes/run-stream.ts` owns Hono SSE and browser detachment; `agent/run-execution.ts` constructs the official Aegra adapter without depending on HTTP. Model eligibility is an application admission policy in `conversation/runs/model-validation.ts`, rather than part of the upstream client.

## Dependencies and ownership

Application entries assemble routes and resource owners. Routes/middleware may use capabilities. Conversation may use the Aegra adapter, database, storage and telemetry. The Aegra adapter does not depend on conversation, knowledge or memory. Database, storage and telemetry remain independent of capabilities and HTTP.

`server/eslint.architecture.js` checks imports, re-exports and dynamic imports. Business code cannot import Hono or transport modules. Colocated tests may assemble the app and resource owners to verify actual behavior; `tests/architecture.test.js` exercises the production dependency rules.

Admission owns the transaction that serializes submissions with management and validates retry identity, model availability and reviews. The run store owns conditional state writes and dispatch ownership. Dispatch and recovery coordinate through that store; extracting admission does not create another writer or lifecycle owner. Snapshot reads remain separate from upstream synchronization.

`main.ts` remains the sole process shutdown owner. It drains HTTP, workers and subscriptions, releases object storage/database resources, then flushes telemetry. Moving code does not change the server-owned run behavior when a browser disconnects. See [admission and recovery consistency](architecture.md#admission-and-recovery-consistency).

## TypeScript and naming

The backend runs as Node ESM through `tsx`. Its compiler uses `module: NodeNext` and `moduleResolution: NodeNext`; relative imports spell the runtime `.js` extension, which TypeScript/tsx resolve to source `.ts` files. The root package is also ESM so repository `shared/` contracts use the same module semantics. The browser uses Bundler resolution independently. This follows the host-specific resolution guidance in the [TypeScript module reference](https://www.typescriptlang.org/docs/handbook/modules/reference).

Module names describe their responsibility in kebab-case. Avoid generic `service.ts`, `client.ts` or `schema.ts` where the name hides the actual responsibility. Test files share the implementation stem; PostgreSQL checks end in `.integration.test.ts`. Migrations remain at `server/drizzle`, and `db/database.ts` resolves that directory relative to its own module rather than the current working directory.

## Validation

```sh
pnpm --filter agent-playground-server check
pnpm --filter agent-playground-server lint
pnpm --filter agent-playground-server test
```

Unit checks include import boundaries, migration discovery, SSE behavior and shutdown ordering. Integration checks use disposable PostgreSQL and S3 containers to cover admission, model selection, recovery, task continuation, management and file/document lifecycles. They do not reuse the development database.
