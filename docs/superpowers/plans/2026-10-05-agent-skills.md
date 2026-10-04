# Agent Skills Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan in the current checkout. The user authorized a working version and explicitly declined a worktree.

**Goal:** Run project-published Skill scripts in local Docker and deliver input/output files through chat.

**Architecture:** Existing LangChain tools call the OpenSandbox SDK inside Aegra's per-execution graph context. The TypeScript server owns persisted conversation files; the UI uses ordinary tool messages and attachment controls.

**Tech Stack:** Python, LangChain, OpenSandbox 0.1.x SDK / 1.1.1-rc.1 official server image, Docker Compose, Hono, Drizzle, PostgreSQL, AWS S3 SDK, SeaweedFS, React.

**Spec:** `docs/superpowers/specs/2026-10-05-agent-skills.md`

## Global Constraints

- Keep current checkout; preserve unrelated changes.
- Keep agent logic in Python and file HTTP/storage in TypeScript.
- One CPU, 512 MiB, 256 processes; 120-second script deadline and 20-minute sandbox TTL.
- 10 MiB/file; four inputs and four declared outputs/call; bounded logs.
- Published `.py`, `.sh`, `.js` only; default-deny configured egress.
- No script retries or cross-turn sandbox persistence.

## Review Focus

- Path traversal, symlinks and command argument injection.
- Simultaneous calls or cancellation leaking a sandbox or using another run's files.
- Upload/download across conversation boundaries and after deletion.
- Missing or oversized output files and ambiguous command outcomes.
- Attachments leaking into a different conversation or clearing an unsent prompt on failure.

### Task 1: Skill catalog and execution

**Files:** `agent_playground/skills/{catalog,sandbox,tools}.py`, `agent_playground/graph.py`, `tests/test_skills.py`, `infra/skills/`, `skills/`, `compose.yaml`, `Makefile`, `.env.example`.

**Interfaces:** `SkillCatalog` resolves immutable Skill files; `SkillSession` runs a published script with arguments and staged bytes and returns logs/exit status/declared output bytes. `skill_execution()` owns per-run cleanup.

- [x] Write catalog and session tests; verify missing behavior fails.
- [x] Implement SDK-backed lazy creation, serialized script calls, deadlines and cleanup; add Compose/image configuration.
- [x] Verify tests and real Docker interpreter/file/network behavior.

### Task 2: Conversation file storage and delivery

**Files:** `shared/skill-files.ts`, `server/db/skill-file-schema.ts`, `server/conversation/skill-files.ts`, `server/http/skill-file-routes.ts`, `server/app.ts`, `server/conversation/management.ts`, Drizzle migration, `server/conversation/skill-files.integration.test.ts`, `agent_playground/skills/files.py`.

**Interfaces:** `POST /conversations/:threadId/files` receives user bytes. Authenticated internal routes stage files and publish outputs tied to `threadId`/`aguiRunId`. `GET /conversations/:threadId/files/:fileId` downloads with attachment headers.

- [x] Write HTTP/database ownership, size, malformed input and deletion tests; watch failure.
- [x] Implement routes/storage and Python transfer client; generate migration with Drizzle.
- [x] Run integration tests against temporary PostgreSQL and SeaweedFS, including S3 failure recovery.

### Task 3: Chat integration and verification

**Files:** Composer and conversation session, attachment API/component, assistant Skill output links, adjacent Vitest tests, graph tool test, live sandbox smoke script, `README.md`, `AGENTS.md`.

- [x] Write attachment interaction and result recovery tests; watch failure.
- [x] Wire uploads to send; expose validated downloads outside collapsed tool details; register Skill tools and prompts.
- [x] Run `make check`, relevant browser regression and real Docker smoke; report real-model validation separately.
- [x] Review the complete diff and resolve material findings before delivery.

## Verification result

- `make check`: passed Python and TypeScript checks, tests and production build.
- Browser regressions: 33 passed using temporary PostgreSQL and SeaweedFS.
- Real-model Skill tests: 2 passed, including persisted CSV result download after reload and external HTTP JSON output.
- Official OpenSandbox `release-1.1.1-rc.1` smoke: Python/Bash/Node, staged files, allowed/denied egress, shared workspace, timeout cleanup and actual Docker loopback bindings passed. Native `publish_host` replaces the earlier startup patch.
- Complete implementation review and focused verification of the fixes found no remaining material defects.
