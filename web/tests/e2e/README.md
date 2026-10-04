# Browser coverage ownership

Use E2E for a risk that needs a browser or spans the frontend, protocol adapter, API and database. Explain that risk when adding a case. Use nearby Vitest tests for parsing, state transitions, callback wiring and error branches that do not depend on native browser behavior.

| Browser group                         | Unique risk retained                                                                                                                    |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Conversation, SQL, external workflows | Local font loading, stream/recovery/persistence, edited approval, strict accept gates, realtime notifications, background continuation  |
| Links and management                  | Independent browser URLs, navigation, rename/delete persistence, switching during a live run without resubmission                       |
| Scroll                                | Native wheel events, stable Markdown/code geometry, reading-position preservation, following paced content                              |
| Composer and navigation               | Responsive bounds, popover placement, pointer resizing and saved widths                                                                 |
| Settings and clearing                 | Native dialog focus/stacking, mobile layouts, keyboard selection, persistence across reload and browser-local pointer reset             |
| Pagination                            | Native IntersectionObserver geometry, focus/scroll stability, reduced motion, closing a drawer during a pending page                    |
| Activity                              | Browser clipboard, live protocol delta inspection, responsive bounds, pointer resizing                                                  |
| Skills                                | Native file selection, real S3 upload/download, output links restored from the persisted conversation                                   |
| Gallery                               | Official A2UI rendering, editable Monaco initialization, invalid JSON retaining the last valid preview and reset without runtime errors |

Pagination retry and rejected-clear cache preservation live in `useConversationHistory.test.ts`; rejected-clear UI state lives in `SettingsControl.test.ts`. Transport failure with zero events and exported activity issues live in `ActivityPanel.test.ts`. IME handling and preference media changes already have provider/DOM coverage. Browser tests retain native dialog and clipboard behavior rather than repeating every error/input branch.

Import `test` and `expect` from the shared fixture. Ordinary tests use `replyAnimation: false` and `reducedMotion: "reduce"`. Use `test.use({ replyAnimation: true, reducedMotion: "no-preference" })` when gradual presentation is under test; preference-setting cases can keep reduced motion. Cases asserting CSS animation explicitly select normal motion. Never reuse a browser context or the development database to save time. The isolated harness database belongs to one test run; use unique conversations and avoid bulk mutations that affect another case. Seed completed history through the isolated harness for scroll tests; submit the target turn through the real application.

Use `createCompletedConversation` for existing discussions needed by links or management tests. It calls the real `/agent` endpoint and checks the persisted run and assistant reply before returning. Create these discussions before loading the page so the initial history query sees them. Keep composer submission in tests of sending or switching away from a live run. Avoid fixed sleeps: wait for observable state, and let native observers process rendered geometry before negative request assertions. Controlled local API polling can use a short interval without shortening its timeout or skipping the persisted terminal state.

Use unique conversation titles and assert the captured thread URL after selecting history. Avoid `.first()` to resolve duplicate saved titles. Live tests must call their `createConversation` fixture before sending: only IDs explicitly created there are eligible for cleanup.

Skill regressions own temporary PostgreSQL and SeaweedFS containers. Live Skill tests use the configured model and local OpenSandbox service, covering CSV inputs and HTTP outputs; they run separately from controlled-model regressions.

Review `test-results/runtime.md` and the CI runtime summary after adding coverage. Budgets are advisory because runner speed varies; exceeding a budget calls for investigation rather than raising timeouts. Capture successful screenshots explicitly with `E2E_CAPTURE=1`, and retain the default first-failure diagnostics.
