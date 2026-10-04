# SQL Workflow Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox tracking.

**Goal:** Run the SQL fetch, check, conversational revision, user acceptance and simulated submission loop alongside the existing experiment workflow.

**Architecture:** Add a checkpointed SQL subgraph and local HTTP demo APIs. Reuse durable A2UI publication and AG-UI interrupts; typed SQL review contracts bind every user action to a workflow, revision and round.

**Tech Stack:** Python, LangGraph, LangChain, FastAPI, httpx, sqlglot, SQLAlchemy, TypeScript, React, Zod, Vitest, Playwright.

**Spec:** ../specs/2026-10-04-sql-workflow-design.md

## Global Constraints

- Preserve the existing experiment workflow and its saved output format.
- Only SQL that passed its current revision's check can be submitted after explicit acceptance.
- Demo submission records SQL and does not execute it.
- Use English code, comments, tests, configuration and UI text; follow repository formatting.
- Persist each interaction round independently and release created clients/resources.

## Review Focus

- Explanation-only dialogue must keep the same SQL revision and avoid another API check.
- Refresh and stale buttons must not accept a different SQL revision or interrupt round.
- Resume admission must archive feedback exactly once without passing ordinary input to Aegra.
- Interrupted nodes must not repeat generation, model calls or submission effects on resume.
- Mixed and parallel reviews must not route composer feedback to an arbitrary workflow.

## Task 1: Demo APIs and SQL graph

Files: `agent_playground/sql_demo/{routes,validation}.py`, `workflows/sql/{models,api,agent,graph,cards,tool}.py`, `db/sql_submissions.py`; existing agent graph, HTTP application and database setup; `tests/test_sql_workflow.py`, `tests/test_sql_demo.py`.

Interfaces: `SqlReview` and `SqlState` bind `workflowCallId`, revision, round and check. `make_sql_workflow(revise, api, checkpointer)` supports controlled models and durable recovery. The registered tool uses the existing configured model.

- [x] Write failing graph/API tests for automatic initial revision, explanation, repeated edits, failed/stale acceptance, abandonment and duplicate receipt.
- [x] Implement generation/check/submit/receipt HTTP contracts, SQL parsing, durable demo receipts, independent graph nodes and typed A2UI cards.
- [x] Run Python focused tests, Ruff and type checks.

## Task 2: Conversation and review UI

Files: shared SQL contract; conversation admission, checkpoint synchronization, session, view and composer; SQL A2UI component and review panel; colocated tests.

Interfaces: typed `sql_review` interrupts accept message/accept/abandon responses. SQL cards carry stable public reply IDs. The session routes feedback only when exactly one SQL interrupt is pending; the server validates the current revision/round before archiving it.

- [x] Write failing contract, feedback routing and UI tests including failed/stale acceptance and explanation recovery.
- [x] Implement typed contracts, archived SQL replies, resume feedback and current SQL card/review presentation.
- [x] Run focused Vitest and TypeScript checks.

## Task 3: End-to-end verification and demo access

Files: controlled Aegra fixture, SQL browser tests, README and optional live smoke.

- [x] Extend the fixture and verify repeated interaction, reload, acceptance and abandonment through the real frontend/server/database.
- [x] Run `make check` and `pnpm test:e2e`; retain existing experiment coverage.
- [x] Restart managed development services and run a live model smoke if credentials/services are available. Report this separately from controlled tests.
- [x] Review the complete diff, fix material findings and document demo limitations and entry prompt.


## Verification Results

- `make check`: Python 32 tests, server 42 tests and web 143 tests passed; type checks, lint, formatting and build passed.
- Full controlled browser regression: 34 tests passed. After review fixes, the SQL acceptance/abandonment and original paused workflow cases passed again (3 tests).
- Real configured-model smoke covered initial revision, explanation without SQL changes, another SQL edit, reload and accepted submission.
- Independent review found cross-conversation receipt key collisions and completed tool results attaching to the last feedback turn. Both were fixed with failing-then-passing regression tests; submission identity now includes the conversation thread, and tool results resolve their original call.
- Demo APIs record submissions without executing SQL. Their check covers the supported demo syntax and schema, not production performance or business correctness.
