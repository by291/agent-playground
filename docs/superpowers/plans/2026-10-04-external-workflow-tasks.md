# External Workflow Tasks Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline; track each end-to-end task. One independent review at the end.

**Goal:** Generalize externally updated async tasks, browser-independent workflow continuation and live conversation recovery.

**Architecture:** Durable task/event contracts and a conversation-owned background continuation worker; PostgreSQL notifications/SSE invalidate snapshots; Python report workflow uses an external-wait interrupt and a separate durable demo API.

**Tech Stack:** Existing PostgreSQL/Drizzle, Aegra/LangGraph, Hono SSE, React Query, uv and pnpm. No new infrastructure or dependencies.

**Spec:** ../specs/2026-10-04-external-workflow-tasks.md

## Global Constraints

- English code, tests and UI; Chinese explanatory docs allowed.
- Python owns business logic; conversation owns admission, recovery and runtime state.
- Persist before notifying; no frontend-driven task progression or raw external checkpoint writes.
- Preserve current SQL and experiment behavior; no compatibility layers or workflow DSL.
- Work in the current checkout so the user's local app reflects the result. Do not automatically commit.

## Review Focus

- Early callbacks before the wait checkpoint must remain pending.
- Duplicate/out-of-order callbacks must not duplicate continuation or regress terminal state.
- A closed browser must not prevent progress, final output or reply archiving.
- Ambiguous Aegra creation must not be blindly retried.
- SSE reconnect/switch/unmount must recover snapshots and release connections.

## Task 1: Durable tasks and continuation

Files: shared/external-task.ts; server/db/external-task-schema.ts and generated migration; server/conversation/external-tasks.ts, external-task-worker.ts, changes.ts; server/app.ts, server/server.ts, server/conversation/run-store.ts, reviews.ts, conversation-snapshot.ts; server/conversation/external-tasks.integration.test.ts.

- [x] Write/run failing integration tests for registration, secure updates, history/idempotency/order, terminal gating, early completion and no-browser background continuation.
- [x] Implement `registerExternalTask`, `updateExternalTask`, task snapshots, internal continuation validation/admission and background dispatch/reconciliation using native Aegra runs.
- [x] Add transactional notifications and SSE invalidation with cleanup and reconnect snapshot semantics.
- [x] Verify integration and current conversation regressions.

## Task 2: Online/offline UI

Files: web/.../api/contracts.ts, events.ts; ConversationProvider.tsx; runtime/session.ts; model/state.ts, selectors.ts, view.ts; ui/ExternalTaskPanel.tsx, ChatPane.tsx, Composer.tsx; focused model/provider tests; browser fixture and regression tests.

- [x] Write/run failing tests for external waiting, task revision recovery, SSE-driven refresh/cleanup and task placement without business names.
- [x] Subscribe to changes for saved conversations; Query delivers snapshots; show reusable task status/history and external-wait text.
- [x] Add controlled browser tests for live status changes, closing the page before completion and later restoring archived results.
- [x] Verify frontend and browser regressions.

## Task 3: Python report example and full verification

Files: agent_playground/workflows/external.py and report/{graph,tool}.py; report_demo/{models,jobs,routes,worker}.py; db/report_jobs.py; http.py, graph.py; tests/test_external_workflow.py, test_report_demo.py; Welcome.tsx; docs/workflow-mechanisms.md, README.md, AGENTS.md; real-model browser smoke.

- [x] Write/run failing Python tests for external-wait identity/terminal validation, stable registration and idempotent persistent demo callbacks/restart.
- [x] Implement the helper, report business graph and independently advancing mock API with explicit lifespan ownership.
- [x] Update docs and restart services; verify complete checks, browser suite and real Python/model online/offline report flow.
- [x] Independent review and fix material findings; record final evidence here.


## Execution record

- Work remains in the current checkout and is uncommitted, as scoped above.
- Baseline failures verified task registration/continuation, external wait detection, SSE refresh, background-run ownership, and browser restoration before implementing them.
- Follow-up RED/GREEN cases cover misleading review labels, deleted-job delivery cleanup, open-SSE shutdown and no-op notification churn.
- Added registration replay, callback ordering/credentials, early completion, concurrent admission, lost-create-response recovery, unconfirmed-create gating and external failure tests.
- Native SDK uses `runs.create(threadId, assistantId, payload)`; configured metadata preserves the existing AG-UI run mapping.
- Report API state generation belongs in `report_demo/jobs.py`; the DB repository takes domain fields and owns storage only.
- The added tool increases fixed context size; oversized-request coverage uses a window large enough to admit the graph, with a request that exceeds it.
- Real-model browser report smoke passed; a separate direct-DB restart check paused at revision 1, restarted all app services and verified five persisted revisions, two runs, one output and an archived reply without any conversation GET.
- Initial full `make check`: 44 Python, 55 server and 153 web tests passed; all 35 controlled browser cases passed. Real failed-report verification also persisted terminal failure, result card and reply without a conversation GET.
- Final review found two material issues: experiment review with an external wait silently refused submission; serial worker requests lacked transport deadlines/abort ownership. Both reproductions failed before fixes.
- Fix pass: mixed review submits only plan interrupts; background client bounds each request to 10 seconds, disables SDK retries, owns a shutdown abort signal, and is passed through reconciliation/checkpoint reads. Stalled POST and GET shutdown, plus another task behind a timed-out POST, now pass. Final `make check` passed: 44 Python, 58 server and 154 web tests, dev lifecycle tests, type/lint/format checks and production build. Final browser verification passed: all 35 controlled cases and the real-model live report test (17.3 seconds), including page closure before terminal completion and restored history.
- Rulings: keep the documented scope without a workflow DSL, cancellation, external-job deadlines or new concurrent user turns; unknown native creation stays unconfirmed until mapping recovery; job idempotency remains the external service's responsibility. These limits require an explicit future design if expanded. Production authentication/quotas and high-volume scan/subscription capacity remain outside this local demonstration.
