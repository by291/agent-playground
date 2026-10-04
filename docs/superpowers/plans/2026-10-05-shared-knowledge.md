# Shared Knowledge Implementation Plan

> Use superpowers:executing-plans in the current checkout. The user requested a trial implementation; repository instructions permit direct progress after clarifying requirements.

**Goal:** Upload shared documents, index in the background and answer across conversations with retrieved sources.

**Architecture:** TS owns S3 and document lifecycle; Python owns durable indexing and a LangChain search tool. PGVectorStore uses pgvector tables managed through Drizzle. Web adds a Knowledge page and source display from persisted tool results.

**Spec:** `docs/superpowers/specs/2026-10-05-shared-knowledge.md`

## Constraints and review focus

- 10 MiB upload, 120-second indexing deadline, three-minute generation lease, bounded excerpts/results.
- Preserve local PG data and the current checkout; no tenant subsystem, OCR or speculative ANN indexes.
- Hide deleted/reindexed/staged chunks before nearest-neighbor search.
- A stale worker cannot publish after lease replacement, retry or deletion.
- Failed S3 upload/deletion stays durable; one denied object cannot block other cleanup.
- Embedding profile changes never search old model vectors; UI errors and citations remain honest.
- Every client/worker/pool is closed by its creator.

## Task 1: Persistence and documents

Files: shared/knowledge.ts, server/db/knowledge-schema.ts, server/storage/object-store.ts, server/knowledge/{documents,cleanup}.ts, server/http/knowledge-routes.ts, Compose and tests.

- [x] Write integration assertions for durable upload, malformed requests, retry and immediate deletion visibility; run isolated DB/S3 checks.
- [x] Generalize S3 settings/client; migrate document and chunk tables with pgvector; append default infrastructure changes without removing data.
- [x] Implement document routes and independent cleanup; verify isolated DB/S3 tests.

## Task 2: Indexing and retrieval

Files: agent_playground/knowledge/{config,documents,store,worker,tools}.py, agent_playground/db/knowledge.py, HTTP lifespan/agent registration and tests/test_knowledge.py.

- [x] Write extraction and real-pgvector worker tests: ranking, restart reclaim, stale publication, retry, profile filtering and deletion.
- [x] Implement extraction, OpenAI-compatible embeddings and PGVectorStore; publish only under the generation lock.
- [x] Add bounded search tool and source contract; close owned resources at shutdown; verify focused tests.

## Task 3: UI and end-to-end validation

Files: web/src/features/knowledge/, pages/knowledge/, app routes, chat source UI, adjacent tests and web/tests/e2e/regression/knowledge.spec.ts.

- [x] Test upload failure/state retention and restored source display.
- [x] Implement shared Knowledge page, navigation and source excerpts with existing accessible components.
- [x] Verify browser lifecycle with real HTTP/S3, full checks and configured real-provider/model behavior where available.
- [x] Review complete diff, resolve defects and update README/AGENTS.

## Verification record

- The initial extraction test failed with the missing knowledge module before implementation.
- `make check` passed: 58 Python tests, 68 server tests, 169 web tests, type/lint/format checks and production build. An additional generated two-page text PDF test then passed with the five focused knowledge tests.
- Complete Playwright regression passed: 34 browser tests. The RAG browser fixture uses real TS HTTP/S3, the production Python indexer/retriever, pgvector and a controlled OpenAI-compatible embedding HTTP endpoint. It exercises provider failure, retry, two conversations, restored sources, downloads and deletion.
- Independent review reproduced and resolved async publication cancellation, surviving extraction threads, blocking initial DB setup and late remote S3 PUT cleanup. Focused cancellation and late-object tests passed.
- Local PostgreSQL 18 volume was retained when switching to pgvector; existing tables remained readable. The updated local stack serves `/knowledge` and the proxied document API successfully.
- Qwen compatibility regression reproduced HTTP 400 for the former batch size of 32. Configurable batches passed against a controlled endpoint that enforces limits of 20 and 7 while preserving all 45 vectors in input order. The full Python suite then passed: 61 tests, with focused Ruff and type checks passing.
- The configured `qwen3.7-text-embedding-flash` endpoint returned 20 synthetic embeddings of 1024 dimensions in one request. After explicit user authorization, the uploaded TXT document indexed successfully into 190 chunks using batches of 20. A document question retrieved five matching excerpts, all within the configured cosine-distance threshold of 0.55. No substitute embeddings were used.
