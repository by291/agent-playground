# Browser tests

[Documentation index](../../../docs/README.md) · [Local development and checks](../../../docs/development.md)

## Controlled regression

Prepare the root Python environment and install Chromium before running the isolated suite:

```sh
uv sync --locked --python 3.12
pnpm --filter agent-playground-web exec playwright install chromium
pnpm test:e2e
pnpm --filter agent-playground-web test:e2e:ui
```

`pnpm test:e2e` needs Docker and the root Python environment prepared by `uv sync`. It starts isolated PostgreSQL and S3 containers, the real TypeScript backend on `127.0.0.1:4300`, a Python knowledge worker/retriever on `127.0.0.1:4301`, a production build served by Vite preview on `127.0.0.1:4173`, and a development frontend on `127.0.0.1:4174`. These ports must be free. Business regression tests use `production-chromium`; Activity and Gallery use `development-chromium`, because these tools are excluded from production. The harness supplies deterministic Aegra HTTP responses, durable workflow outputs and a controlled embedding endpoint; it does not run the Python agent or contact an external model. Browser requests pass through the real frontend, AG-UI adapter, API and database. Playwright owns the servers, and the harness releases its containers, Python process and connections on shutdown. Tests cover welcome restoration, tool details, streamed code and copying, reload during a run, edited workflow approval, sidebar resizing, live external-task progress, browser-independent continuation, shared knowledge indexing/retrieval and the development gallery. CI runs the complete suite in one job with one browser worker and isolated test services and database. Obsolete CI runs on the same branch or pull request are cancelled. The job prepares Python dependencies, installs Chromium Headless Shell and its Linux dependencies, then uploads its HTML report, failure screenshots, traces and runtime data as `playwright-report`.

## Live smoke

Start the [development stack](../../../docs/development.md), then explicitly select its frontend:

```sh
E2E_BASE_URL=http://127.0.0.1:5173 pnpm test:e2e:live
```

The live suite creates test conversations and may consume model tokens. It connects to the existing stack without starting a fixture, uses a fresh browser context per test, and is excluded from normal CI. Requests use the selected frontend's proxy, including exact conversation recovery. `createConversation` captures ownership before submission; successful tests delete only these IDs. Failed tests and cleanup failures retain an attached list of conversation IDs for diagnosis, and cleanup failures fail the test. Its gallery case needs the development frontend. HTML reports are written to `web/playwright-report/`; traces and screenshots are kept under `web/test-results/` on failure. Use `pnpm --filter agent-playground-web exec playwright show-report` to view the latest regression report, or append `playwright-report/live` for the live report.

## Reports and visual inspection

The regression reporter writes `web/test-results/runtime.json` and `runtime.md`, including individual attempts, file/project totals and the slowest cases. CI publishes the Markdown summary and retains the data. Advisory budgets are 10 seconds per test and 120 seconds of summed test durations. Summed durations differ from Playwright elapsed time, which also includes service startup/teardown; the CI job adds installation and report upload. Filtered or repeated runs report only their executed attempts.

```sh
E2E_CAPTURE=1 pnpm test:e2e
pnpm --filter agent-playground-web exec playwright show-report
pnpm --filter agent-playground-web exec playwright show-report playwright-report/live
```

Successful screenshots are opt-in and disable CSS animations for capture. They have no visual comparison baseline. Failure screenshots and `retain-on-failure` traces are always enabled; traces are recorded during tests and discarded on success.

## Coverage ownership

Use E2E for a risk that needs a browser or spans the frontend, protocol adapter, API and database. Explain that risk when adding a case. Use nearby Vitest tests for parsing, state transitions, callback wiring and error branches that do not depend on native browser behavior.

| Browser group                         | Unique risk retained                                                                                                                               |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conversation, SQL, external workflows | Local font loading, stream/recovery/persistence, edited approval, strict accept gates, realtime notifications, background continuation             |
| Links and management                  | Independent browser URLs, navigation, rename/delete persistence, switching during a live run without resubmission                                  |
| Scroll                                | Native wheel events, stable Markdown/code geometry, reading-position preservation, following paced content                                         |
| Composer and navigation               | Responsive bounds, popover placement, pointer resizing and saved widths                                                                            |
| Settings and clearing                 | Native dialog focus/stacking, mobile layouts, keyboard selection, persistence across reload and browser-local pointer reset                        |
| Pagination                            | Native IntersectionObserver geometry, focus/scroll stability, reduced motion, closing a drawer during a pending page                               |
| Activity                              | Browser clipboard, live protocol delta inspection, responsive bounds, pointer resizing                                                             |
| Skills and knowledge                  | Native file selection, real S3 transfers and Python indexing/retrieval; restored output links, inline citations, source selection and reader focus |
| Gallery                               | Official A2UI rendering, editable Monaco initialization, invalid JSON retaining the last valid preview and reset without runtime errors            |

Pagination retry and rejected-clear cache preservation live in `useConversationHistory.test.ts`; rejected-clear UI state lives in `SettingsControl.test.ts`. Transport failure with zero events and exported activity issues live in `ActivityPanel.test.ts`. IME handling and preference media changes already have provider/DOM coverage. Browser tests verify Radix modal focus handling and real clipboard behavior rather than repeating every error/input branch.

Import `test` and `expect` from the shared fixture. Ordinary tests use `replyAnimation: false` and `reducedMotion: "reduce"`. Use `test.use({ replyAnimation: true, reducedMotion: "no-preference" })` when gradual presentation is under test; preference-setting cases can keep reduced motion. Cases asserting CSS animation explicitly select normal motion. Never reuse a browser context or the development database to save time. The isolated harness database belongs to one test run; use unique conversations and avoid bulk mutations that affect another case. Seed completed history through the isolated harness for scroll tests; submit the target turn through the real application.

Use `createCompletedConversation` for existing discussions needed by links or management tests. It calls the real `/agent` endpoint and checks the persisted run and assistant reply before returning. Create these discussions before loading the page so the initial history query sees them. Keep composer submission in tests of sending or switching away from a live run. Avoid fixed sleeps: wait for observable state, and let native observers process rendered geometry before negative request assertions. Controlled local API polling can use a short interval without shortening its timeout or skipping the persisted terminal state.

Use unique conversation titles and assert the captured thread URL after selecting history. Avoid `.first()` to resolve duplicate saved titles. Live tests must call their `createConversation` fixture before sending: only IDs explicitly created there are eligible for cleanup.

Skill regressions own temporary PostgreSQL and SeaweedFS containers. Live Skill tests use the configured model and local OpenSandbox service, covering CSV inputs and HTTP outputs; they run separately from controlled-model regressions.

Review `test-results/runtime.md` and the CI runtime summary after adding coverage. Budgets are advisory because runner speed varies; exceeding a budget calls for investigation rather than raising timeouts. Capture successful screenshots explicitly with `E2E_CAPTURE=1`, and retain the default first-failure diagnostics.
