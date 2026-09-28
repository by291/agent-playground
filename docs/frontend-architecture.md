# Frontend architecture

The frontend groups code by application entry, page composition, product capability, and shared foundations. Add code to the capability that owns its behavior; create another feature only when it has an independent responsibility.

## Structure

```text
web/
  src/
    main.tsx                         Browser bootstrap
    app/                             Routes, configuration, providers, page errors
    pages/
      chat/ChatPage.tsx               Conversation selection and page composition
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
    components/                      Shared application widgets
      ui/                            shadcn/ui primitives
    lib/                             Small shared utilities
    observability/                   Browser tracing and error reporting
    styles/                          Theme, base rules and shared motion
  tests/
    dom.ts                           JSDOM setup for colocated interaction tests
    architecture.test.js             Import-boundary regression tests
    e2e/flows.js                      Browser smoke flows with a caller-owned tab
```

There is one conversation feature, including its chat UI. `pages/chat` is its route entry. The component workspace owns development-only editor state and examples; shared A2UI processing stays in the A2UI feature.

## Dependencies

```text
app → pages → features → components / lib / observability / shared contracts
                   conversation → a2ui
```

`main.tsx` starts the app. Pages import a feature's `index.ts`; the A2UI renderer has a separate public entry so it can load lazily. Features cannot import pages or application configuration. Shared foundations cannot import a feature. Pages cannot import another page's private modules.

Conversation API and model code cannot import its runtime, UI or React provider. Runtime can depend on API and model code; UI subscribes through the provider and cannot import runtime internals. Feature internals use local imports rather than their own barrel, preventing a cycle through the public entry. ESLint enforces these boundaries, including dynamic imports and re-exports.

Protocol types and parsing remain owned by the official AG-UI and A2UI libraries. Repository-level `shared/` contains application contracts such as run status and context usage, accessed through `@shared/*`.

## State and resources

| Owner | Responsibility |
| --- | --- |
| TanStack Query | Fetch/cache snapshots by conversation ID, cancellation, retries, conditional refresh. |
| Official `HttpAgent` | AG-UI streaming messages, state and event processing. |
| Conversation session | Submission identity, reconciliation, projected store, lifecycle, A2UI ingestion and resource release. |
| Pure model functions | Reconcile old/new data, derive input availability, group turns and attach workflow artifacts. |
| React components | Input drafts, tool folds, review edits and activity-panel visibility. |
| Development preview model | JSON drafts and disposable preview runtimes. |

The store is scoped to one conversation. SDK messages and snapshots enter the same session projection; Query does not implement reconciliation. `ConversationProvider` delivers only completed fetches after mount, so old cached data cannot decide whether to retry a saved submission.

The session creates its SDK subscription and A2UI runtime when connected and releases both on disconnect. Detaching the browser stream does not cancel the server-owned run. The gallery releases preview resources when replacing a valid preview, resetting or unmounting.

### Lifecycle

| Dimension | Values | Purpose |
| --- | --- | --- |
| Hydration | `fresh`, `restoring`, `ready` | Whether this page must recover before accepting input. |
| Execution | `idle`, `submitting`, `streaming`, `awaiting-snapshot`, `recovering-run` | Whether local submission or server execution still needs to settle. |
| Synchronization | `deferred`, `on-demand`, `polling` | Whether the snapshot query is disabled, enabled normally or temporarily polling for recovery. |

`transitionLifecycle` updates these dimensions from named events. Query policy, composer availability and loading presentation are derived selectors. An empty-page hint affects first rendering; actual messages, surfaces and interrupts still determine whether a conversation is empty. Run, snapshot and output errors occupy separate slots with one presentation priority.

A fresh conversation does not query an absent snapshot before its first stream settles. Restored conversations fetch before accepting input. Idle conversations and healthy local streams do not poll; recovery failures, unknown/unfinished remote runs and missing outputs can enable polling. A final snapshot confirms execution and returns synchronization to normal Query behavior. Query's focus refresh and the independent gateway health check remain available.

`conversationView` groups assistant/tool messages by user turn, attaches surfaces once, preserves unattached surfaces and places pending review editors. `ChatPane` memoizes this work by the four relevant data arrays, so context/activity updates do not rebuild the view model.

## Application and styling

`app/config.ts` validates browser environment flags with Zod. `app/providers.tsx` creates the app's QueryClient. `PageBoundary` reports page rendering failures and presents a reload action. Individual A2UI rendering failures retain their surface-level boundary.

The development gallery import is guarded directly by Vite's compile-time `import.meta.env.DEV`. Keep that static guard when changing routing; a parsed runtime configuration object cannot provide the same elimination guarantee. The production build fails if emitted chunks include `pages/dev` or Monaco modules. Components and Activity controls are development-only; `/dev/a2ui-components` is unavailable in production.

`styles/theme.css` is the shared token source. shadcn variables reference the same semantic colors instead of repeating palette values. Global base/motion rules and feature-specific CSS are separate. The editor/gallery CSS loads with its development page. Shared app-header branding lives in `components/AppBrand.tsx`.

## Validation

```sh
pnpm --filter agent-playground-web check
pnpm --filter agent-playground-web lint
pnpm --filter agent-playground-web test
pnpm --filter agent-playground-web build
pnpm format:check
```

Unit, SDK session and DOM interaction tests are colocated with their modules. Interaction tests use [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/), user-event and [JSDOM](https://github.com/jsdom/jsdom) with Node's test runner. They cover actual input, tool folds and edited review submission. The provider test mounts Query, the session and the official streaming SDK together using controlled HTTP responses, checking fresh-query deferral and restored snapshot delivery.

Browser smoke flows live in `web/tests/e2e/flows.js`. They accept a caller-owned tab exposing the browser tool's Playwright locator API and run against the local backend. Invoke `verifyFreshWelcome`, then `verifyToolReply`; invoke `startWorkflowReview`, reload while paused, then `approveWorkflowReview`; open the development gallery in another tab and invoke `verifyGallerySelection`. These flows create test conversations and use the configured model. They run through the browser tool and are not launched by `pnpm test`; a passing DOM suite alone does not establish browser or real-model compatibility.

Keep real-model/browser validation separate from controlled-response tests. Production bundle validation establishes development-code exclusion, while browser validation establishes visible behavior. The existing authentication and durable event-replay limitations remain outside this frontend reorganization.
