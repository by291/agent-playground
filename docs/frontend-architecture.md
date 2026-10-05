# Frontend architecture

[Documentation index](README.md) · [Architecture](architecture.md)

The frontend groups code by application entry, page composition, product capability, and shared foundations. Add code to the capability that owns its behavior; create another feature only when it has an independent responsibility.

## Structure

```text
web/
  src/
    main.tsx                         Browser bootstrap
    app/                             Routes, configuration, providers, page errors
    pages/
      chat/ChatPage.tsx               Conversation selection and page composition
      knowledge/KnowledgePage.tsx     Shared document management page
      dev/a2ui-components/            Development editor, examples and previews
      NotFoundPage.tsx
    features/
      conversation/
        index.ts                     Public page-facing API
        ConversationProvider.tsx     Query delivery and scoped React subscriptions
        api/                         HTTP snapshots, contracts and Query options
        model/                       Lifecycle, reconciliation, selectors and view model
        runtime/                     Session, submission and official SDK adaptation
        ui/                          Workspace, messages, composer and review
      a2ui/
        index.ts                     Public runtime/catalog API
        A2UISurface.tsx              Public lazy renderer entry
        runtime/                     Validation, ordered ingestion and disposal
        catalog/                     Component schemas and renderers
      knowledge/                     Shared document API and upload/indexing UI
    components/                      Shared application widgets
      ui/                            shadcn/ui primitives
    lib/                             Small shared utilities
    observability/                   Browser tracing and error reporting
    styles/                          Theme, base rules and shared motion
  tests/
    setup.ts                         DOM cleanup and Vitest mock/timer restoration
    architecture.test.js             Import-boundary regression tests
    e2e/                             Playwright regression and live smoke suites
```

There is one conversation feature, including its chat UI. `pages/chat` is its route entry. The component workspace owns development-only editor state and examples; shared A2UI processing stays in the A2UI feature.

The knowledge feature owns shared-document management. Citation presentation belongs to conversation messages because it uses that reply's archived search results; both use `shared/knowledge.ts` rather than importing the other feature's private modules.

## Dependencies

```text
app → pages → features → components / lib / observability / shared contracts
                   conversation → a2ui
```

`main.tsx` starts the app. Pages import a feature's `index.ts`; the A2UI renderer has a separate public entry so it can load lazily. Features cannot import pages or application configuration. Shared foundations cannot import a feature. Pages cannot import another page's private modules.

Conversation API and model code cannot import its runtime, UI or React provider. Runtime can depend on API and model code; UI subscribes through the provider and cannot import runtime internals. Feature internals use local imports rather than their own barrel, preventing a cycle through the public entry. ESLint enforces these boundaries, including dynamic imports and re-exports.

Protocol types and parsing remain owned by the official AG-UI and A2UI libraries. Repository-level `shared/` contains application contracts such as run status and context usage, accessed through `@shared/*`.

## State and resources

| Owner                     | Responsibility                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------- |
| TanStack Query            | Fetch/cache snapshots by conversation ID, cancellation, retries, conditional refresh.                 |
| Official `HttpAgent`      | AG-UI streaming messages, state and event processing.                                                 |
| Conversation session      | Submission identity, reconciliation, projected store, lifecycle, A2UI ingestion and resource release. |
| Pure model functions      | Reconcile old/new data, derive input availability, group turns and attach workflow artifacts.         |
| React components          | Input drafts, tool folds, review edits and activity-panel visibility.                                 |
| User preferences provider | Browser-local appearance, send shortcut and reply animation; theme media subscriptions and cleanup.   |
| Development preview model | JSON drafts and disposable preview runtimes.                                                          |

The store is scoped to one conversation. SDK messages and snapshots enter the same session projection; Query does not implement reconciliation. `ConversationProvider` delivers only completed fetches after mount, so old cached data cannot decide whether to retry a saved submission.

The session creates its SDK subscription and A2UI runtime when connected and releases both on disconnect. Detaching the browser stream does not cancel the server-owned run. The gallery releases preview resources when replacing a valid preview, resetting or unmounting.

### Lifecycle

| Dimension       | Values                                                                   | Purpose                                                                                       |
| --------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Hydration       | `fresh`, `restoring`, `ready`                                            | Whether this page must recover before accepting input.                                        |
| Execution       | `idle`, `submitting`, `streaming`, `awaiting-snapshot`, `recovering-run` | Whether local submission or server execution still needs to settle.                           |
| Synchronization | `deferred`, `on-demand`, `polling`                                       | Whether the snapshot query is disabled, enabled normally or temporarily polling for recovery. |

`transitionLifecycle` updates these dimensions from named events. Query policy, composer availability and loading presentation are derived selectors. An empty-page hint affects first rendering; actual messages, surfaces and interrupts still determine whether a conversation is empty. Run, snapshot and output errors occupy separate slots with one presentation priority.

A fresh conversation does not query an absent snapshot before its first stream settles. Restored conversations fetch before accepting input. Idle conversations and healthy local streams do not poll; recovery failures, unknown/unfinished remote runs and missing outputs can enable polling. A final snapshot confirms execution and returns synchronization to normal Query behavior. Query's focus refresh and the independent gateway health check remain available.

The root route starts with an unallocated draft. The session allocates its thread ID on the first valid submission, before attachment upload. Route promotion keeps the same provider key and mounted session; explicit conversation switching changes that key and releases the previous session. See [conversation behavior](conversations.md#drafts-and-the-first-submission).

`conversationView` groups assistant/tool messages by user turn, attaches surfaces once, preserves unattached surfaces and places pending review editors. `ChatPane` memoizes this work by the four relevant data arrays, so context/activity updates do not rebuild the view model.

## Application and styling

`app/config.ts` validates browser environment flags with Zod. `app/providers.tsx` creates the app's QueryClient. `PageBoundary` reports page rendering failures and presents a reload action. Individual A2UI rendering failures retain their surface-level boundary.

The development gallery import is guarded directly by Vite's compile-time `import.meta.env.DEV`. Keep that static guard when changing routing; a parsed runtime configuration object cannot provide the same elimination guarantee. The production build fails if emitted chunks include `pages/dev` or Monaco modules. Components and Activity controls are development-only; `/dev/a2ui-components` is unavailable in production.

`app/providers.tsx` also mounts the shared preferences provider from `lib/preferences.tsx`. It validates browser-local preferences, applies theme changes and releases its system-appearance listener. `components/SettingsControl.tsx` provides shared settings triggers and owns native settings and confirmation dialogs. `ChatPage` mounts `SettingsProvider` outside the keyed conversation provider so settings stay open when clearing history switches conversations. Conversation UI reads the shared preference hook without depending on another feature.

`ChatPage` supplies a clear-history callback to the shared settings provider, and sidebar triggers open the same settings dialog through context. Standalone previews can still mount their own settings control. The conversation feature owns the bulk API call and success coordination: cancel pending history/snapshot reads, remove conversation caches and browser pointers, and switch the keyed provider to a fresh conversation. Preferences and navigation storage remain untouched. The separate confirmation dialog uses the browser's modal focus behavior; cancellation restores focus to the clear-history trigger, pending deletion prevents dismissal, and success closes only confirmation. Request errors stay in confirmation; rejected deletion does not modify local conversation state.

`styles/theme.css` is the shared token source. shadcn variables reference the same semantic colors instead of repeating palette values. Global base/motion rules and feature-specific CSS are separate. The editor/gallery CSS loads with its development page. Shared app-header branding lives in `components/AppBrand.tsx`.

## Components and development tools

shadcn/ui primitives live in `web/src/components/ui/`. To add one, run `pnpm dlx shadcn@latest add <component>` from `web/`; `components.json` contains registry settings. The A2UI catalog keeps each component schema and renderer together in `features/a2ui/catalog/components/`, registered by `catalog/index.tsx`.

Inter weights 400, 500, 600 and 700 are bundled with Fontsource rather than downloaded from Google Fonts at runtime. The development gallery bundles Monaco feature registrations, JSON support and local workers. **Components** opens `/dev/a2ui-components` in another tab; its JSON examples live in `pages/dev/a2ui-components/examples/`. A valid complete surface updates the preview; invalid JSON keeps the last valid result. Chat ingestion separately accepts update-only batches. Preview models are released on replacement, reset and unmount. A2UI actions do not submit backend operations.

**Activity** shows SDK-observed AG-UI events from the current page session with receive times, run/step/tool identity and complete JSON. Its default merged view combines text, reasoning and tool-argument deltas within run/message/call boundaries; turn merging off to inspect individual events. Partial boundaries remain explicitly partial. JSON highlighting is lazy, and original retained values are preserved.

The Activity panel's desktop width is saved separately from navigation width and supports pointer and keyboard resizing. On smaller screens it fills the workspace. **Copy log** includes all retained original events in receive order, the latest run summary and client issues regardless of the filtered/merged view; the retained buffer is capped at 500 events. The badge counts received events since **Clear log**, and discarded entries are marked as a partial log. Clearing the log does not alter conversation data, clear client issues or stop execution; refresh or conversation switching clears the log. Exported event content can contain user data and should be reviewed before sharing.

These events have passed through the server adapter and SDK filtering/normalization. Activity does not capture rejected events, raw HTTP/SSE bytes, Aegra queue diagnostics or a durable replay log; restored checkpoint messages are not historical AG-UI events. Its receive times cannot measure browser paint or queue delay. Both Activity and the component gallery are excluded from production builds.

## Validation

```sh
pnpm --filter agent-playground-web check
pnpm --filter agent-playground-web lint
pnpm --filter agent-playground-web test
pnpm --filter agent-playground-web build
pnpm format:check
```

Unit, SDK session and DOM interaction tests are colocated with their modules and run with [Vitest](https://vitest.dev/). Pure logic tests use the Node environment. DOM interaction files declare `@vitest-environment jsdom` and use [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/), user-event and jest-dom. `web/tests/setup.ts` cleans up rendered components and browser storage, then restores mocks, globals, environment stubs and timers after each test. They cover actual input, tool folds and edited review submission. The provider test mounts Query, the session and the official streaming SDK together using controlled HTTP responses, checking fresh-query deferral and restored snapshot delivery.

`pnpm --filter agent-playground-web test:watch` reruns affected tests during development. `pnpm --filter agent-playground-web test:coverage` collects V8 coverage and writes HTML and LCOV reports under `web/coverage/`. The test configuration reuses the application's Vite transforms and module resolution. Test execution does not replace the separate TypeScript check.

Browser tests live in `web/tests/e2e/` and run with Playwright Test. `flows.ts` shares browser assertions between regression and live smoke. The controlled suite starts Vite and the real TypeScript backend with temporary PostgreSQL/S3 containers and a Python knowledge worker/retriever. `server/tests/e2e/` controls Aegra HTTP responses and embeddings. Pagination and clear-history cases intercept history requests to control timing and isolate bulk deletion; PostgreSQL integration tests verify deletion and admission races. Playwright and the harness release their servers, Python process, pools and containers. See [browser coverage and commands](../web/tests/e2e/README.md).

`E2E_BASE_URL=http://127.0.0.1:5173 pnpm test:e2e:live` runs smoke flows against an already running development stack and the configured model, creating conversations and using model tokens. CI runs the controlled suite rather than live smoke. Both are separate from Vitest coverage. Controlled browser checks validate the frontend/backend and isolated Python knowledge path; full Python agent execution and external-model compatibility require live validation.

Keep real-model/browser validation separate from controlled-response tests. Production bundle validation establishes development-code exclusion, while browser validation establishes visible behavior. The existing authentication and durable event-replay limitations remain outside this frontend reorganization.
