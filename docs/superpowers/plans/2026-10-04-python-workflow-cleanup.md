# Python Workflow Cleanup Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this refactor inline. Steps use checkbox tracking.

**Goal:** Make the Python workflow code easy to navigate without changing behavior or losing paused workflow recovery.

**Architecture:** Group workflow code by business capability under `workflows/`. SQL models, graph, revision agent, HTTP client, cards and tool entry point have separate responsibilities. Keep shared publication in `workflows/output.py`, demo routes and validation under `sql_demo/`, and database reads/writes under `db/`.

**Tech Stack:** Existing Python, LangGraph, Pydantic, FastAPI and SQLAlchemy; no new dependencies.

**Spec:** The user's request to organize the Python code; existing SQL workflow spec remains the behavior contract.

## Global Constraints

- Preserve graph node names, checkpoint fields, tool names, API routes and A2UI payloads.
- Preserve current uncommitted frontend/server changes and the working local demo.
- Keep code, comments and tests in English; do not add a workflow framework or change business behavior.
- Move existing tests' imports and patch targets with their owners.

## Review Focus

- Pre-refactor SQL checkpoints may contain Pydantic values whose module path moves; prove they resume without regenerating SQL.
- Cards must not depend on graph construction, and SQL must not import experiment presentation.
- Database repositories must not raise HTTP errors or depend on request objects.
- Workflow graph construction must preserve nested-tool recovery and idempotent submission identity.

## Task 1: Workflow modules

- [x] Capture a paused SQL checkpoint using the old modules and add a recovery regression.
- [x] Move experiment graph/cards under `workflows/experiment/` and publication under `workflows/output.py`.
- [x] Split SQL into `workflows/sql/{models,graph,agent,api,cards,tool}.py`; update callers and test patch targets. The tool keeps `make_sql_workflow(revise, api, checkpointer)` and `sql_workflow_tool(model)` behavior.
- [x] Run focused workflow/agent/publication tests and Python static checks.

## Task 2: Demo HTTP and persistence

- [x] Split `sql_demo.py` into `sql_demo/routes.py` and `sql_demo/validation.py`.
- [x] Move async submission storage/retrieval into `db/sql_submissions.py`, returning a record or missing value and translating conflicts to HTTP status only in routes.
- [x] Rename shared database setup to `app_engine` and `prepare_app_store`; update all Python consumers.
- [x] Run demo/API and output persistence integration tests.

## Task 3: Verification and documentation

- [x] Update README and AGENTS module responsibilities; remove stale source-path references in the SQL implementation plan.
- [x] Run all Python tests, Ruff and Pyrefly; review the complete Python diff independently.
- [x] Restart local services and run SQL real-model smoke to verify import/route wiring after the move.

## Execution Notes

- Continue in the current checkout: this is a refactor of the already-authorized, uncommitted SQL demo. A new checkout would omit the code being reorganized.
- Use existing behavior tests for the refactor; the additional checkpoint test verifies a material migration risk rather than mirroring implementation.
- Leave changes uncommitted for the user to review.


## Verification Results

- All 33 Python tests passed, including PostgreSQL persistence/checkpoint integration, existing experiment behavior, nested SQL tool recovery and the paused checkpoint captured before module moves.
- Pyrefly: zero errors. Ruff lint and format checks passed. `git diff --check` passed.
- Local services restarted successfully. Real configured-model SQL browser smoke passed: revise, explain without changing SQL, edit again, reload, accept and restore the submission.
- Fresh independent review compared the original Python snapshot with every moved module and found no material defects. Its 16 non-Docker focused tests passed; the parent run verified the PostgreSQL tests with Docker access.
