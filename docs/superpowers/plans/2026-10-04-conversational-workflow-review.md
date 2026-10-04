# Conversational Workflow Review Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline; track each end-to-end task below.

**Goal:** Remove SQL business dependencies from common conversation mechanisms while preserving the SQL and experiment demos.

**Architecture:** Common review contracts and Python interruption helper; optional durable output metadata for replies and presentation; SQL business schemas remain separate from common contracts. Business graphs remain LangGraph code.

**Spec:** ../specs/2026-10-04-conversational-workflow-review.md

## Constraints and Review Focus

- Preserve current SQL and experiment business API behavior.
- A stale, failed or ambiguously targeted review must not submit or receive feedback.
- Recovered outputs/replies must deduplicate and remain attached to their original workflow or feedback turn.
- Keep official AG-UI/A2UI types; metadata belongs to the application envelope, not the A2UI protocol.
- Do not retain old SQL compatibility; no SQL parsing in common admission, archive or composer logic.
- Preserve current-format output identity and experiment form review behavior; delete unsupported SQL history.

## Task 1: Common interaction and output contracts

- [x] Add failing tests for non-SQL review identity, acceptance gate and response handling; generic output replies/presentation.
- [x] Add `workflows/review.py` (`WorkflowReview`, `WorkflowReviewResponse`, `wait_for_review`) and output metadata models/publication support.
- [x] Add `shared/workflow-review.ts`, `workflow-output.ts`; leave only business card schema in `sql-card.ts`.
- [x] Adapt SQL graph/publication to those contracts; preserve current-format recovery and business behavior.

## Task 2: Generic server and frontend mechanisms

- [x] Add failing non-SQL conversation feedback, presentation ownership/history and metadata replay-conflict tests.
- [x] Replace SQL-specific admission, resume adaptation, reply extraction, session actions, composer and decision panel with common contracts.
- [x] Preserve output metadata through A2UI parsing/runtime; generic view groups only explicitly annotated surfaces, and keeps orphan surfaces visible.
- [x] Update controlled fixtures and verify current SQL and experiment paths.

## Task 3: Verification and documentation

- [x] Update README/AGENTS with the actual reusable integration boundaries and examples.
- [x] Run `make check`, controlled browser regression and configured-model SQL smoke after restarting services.
- [x] Perform one independent review of the complete change and fix material findings.

## Execution Notes

Implement in the current checkout to keep the user's local demo directly reviewable. No new dependencies, workflow DSL, secondary product demo, automatic commit or push. Existing behavior tests cover refactors; add targeted regressions for the new reusable contracts and recovery boundaries.

## Verification Evidence

- Previous verification: `make check`, 34 controlled browser tests and configured-model SQL smoke passed for the shared mechanism.
- User then authorized deletion of unsupported history and removal of compatibility. Removed SQL adapters, embedded card reply fields, legacy publish encoding and old checkpoint/replay fixtures. Deleted seven completed legacy SQL conversations through the application API and verified each returns 404. The application uses its existing soft-delete semantics; database rows and Aegra checkpoints remain inaccessible through conversation APIs.
- Current-format recovery, strict publication conflict detection, generic non-SQL feedback/archive/presentation coverage and experiment behavior remain in the regression suite.
- Final verification after compatibility removal: `make check` passed (Python 38, server 44, web 147 tests, types/lint/format/build); controlled Playwright 34 passed; configured-model SQL smoke 1 passed. Initial concurrent checks hit temporary-container port binding timeouts; sequential retries passed without code changes.
