# Browser coverage ownership

Use E2E for a risk that needs a browser or spans the frontend, protocol adapter, API and database. Explain that risk when adding a case. Use nearby Vitest tests for parsing, state transitions, callback wiring and error branches that do not depend on native browser behavior.

| Browser group | Unique risk retained |
| --- | --- |
| Conversation, SQL, external workflows | Stream/recovery/persistence, edited approval, strict accept gates, realtime notifications, background continuation |
| Links and management | Independent browser URLs, navigation, rename/delete persistence, switching during a live run without resubmission |
| Scroll | Native wheel events, stable Markdown/code geometry, reading-position preservation, following paced content |
| Composer and navigation | Responsive bounds, popover placement, pointer resizing and saved widths |
| Settings and clearing | Native dialog focus/stacking, mobile layouts, keyboard selection, persistence across reload and browser-local pointer reset |
| Pagination | Native IntersectionObserver geometry, focus/scroll stability, reduced motion, closing a drawer during a pending page |
| Activity | Browser clipboard, live protocol delta inspection, responsive bounds, pointer resizing |
| Gallery | Official A2UI rendering, editable Monaco initialization without runtime errors |

Pagination retry and rejected-clear cache preservation live in `useConversationHistory.test.ts`; rejected-clear UI state lives in `SettingsControl.test.ts`. Transport failure with zero events and exported activity issues live in `ActivityPanel.test.ts`. IME handling and preference media changes already have provider/DOM coverage. Browser tests retain native dialog and clipboard behavior rather than repeating every error/input branch.

Import `test` and `expect` from the shared fixture. Ordinary tests use `replyAnimation: false`; opt in with `test.use({ replyAnimation: true })` where gradual presentation or changing the animation preference is the behavior under test. Never share a browser context or application database to save time. Seed completed history through the isolated harness for scroll tests; submit the target turn through the real application.

Use unique conversation titles and assert the captured thread URL after selecting history. Avoid `.first()` to resolve duplicate saved titles. Live tests must call their `createConversation` fixture before sending: only IDs explicitly created there are eligible for cleanup.

Review `test-results/runtime.md` and both CI shard summaries after adding coverage. Budgets are advisory because runner speed varies; exceeding a budget calls for investigation rather than raising timeouts. Capture successful screenshots explicitly with `E2E_CAPTURE=1`, and retain the default first-failure diagnostics.
