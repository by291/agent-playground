# E2E Review Fixes Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement the accepted review in this session. The user authorized all fixes; no additional approval or automatic commit is needed.

**Goal:** Resolve all twelve E2E review findings while retaining meaningful browser and cross-layer coverage.

**Architecture:** Shared Playwright fixtures own test preferences and optional captures. Business tests exercise a production build; development tools retain a separate development project. Lower-level tests own error branches, and CI publishes test costs without sharing databases or browser contexts.

**Tech Stack:** TypeScript, Playwright Test, Vitest, Vite, PostgreSQL Testcontainers, GitHub Actions.

**Spec:** The accepted twelve-point E2E review in this conversation, mapped below.

## Global Constraints

- Preserve real backend, isolated temporary PostgreSQL, fresh browser contexts, and owned resource cleanup.
- Keep animated streaming and scroll coverage, native layout, focus, clipboard, and dialog coverage in Chromium.
- No production behavior changes solely for test speed; test helpers belong in test code.
- English code, configuration, and test text. Do not commit or push without a separate user request.

## Review Focus

- Animation opt-in must exercise intermediate text and delayed composer unlocking.
- Restored scroll history must use real persisted data when followed by a submitted turn.
- Closing a drawer during a pending page must prevent further automatic page requests.
- Live cleanup must delete only captured test conversation IDs and retain failed-test diagnostics.
- Cost summaries must account for failures, skips, repeat runs, projects, and shards honestly.

## Task 1: Test infrastructure and scroll costs

**Files:** `web/playwright.config.ts`, `web/tests/e2e/fixtures.ts`, regression specs, `server/tests/e2e/{server,aegra}.ts`.

- [x] Add animation options and an explicit successful-capture mode; keep first-failure screenshots and traces. (1, 9)
- [x] Run business journeys against a built frontend and development tools against Vite. (4)
- [x] Seed modest real history for scroll tests, check representative positions, and retain a paced streaming case. (3)
- [x] Use captured conversation identities rather than repeated titles and `.first()`. (10)
- [x] Verify relevant browser journeys and production/dev project selection.

## Task 2: Coverage and assertion correctness

**Files:** regression specs, nearby DOM/query tests, `web/tests/e2e/live/`, `web/tests/e2e/flows.ts`.

- [x] Move browser error branches to lower-level tests; remove duplicated preference/input assertions. Document retained browser risks. (2)
- [x] Assert rendered Gallery content and absence of renderer errors. (5)
- [x] Exercise closing mobile navigation while a page is pending, then reopening and continuing. (6)
- [x] Poll the live frontend's proxy for the exact conversation, and await a new SQL review round/reply. (7, 8)
- [x] Track live-owned IDs; clean successful tests and attach retained IDs on failure. (11)
- [x] Run DOM/query tests, browser regression, and controlled verification of live helpers. Real-model smoke remains separate.

## Task 3: CI cost feedback and final verification

**Files:** `.github/workflows/ci.yml`, Playwright cost reporter, `README.md`.

- [x] Cancel obsolete branch/PR CI runs and emit per-case/group durations, slow tests, and review budgets in JSON and job summaries. (12)
- [x] Document comparison baseline, E2E admission criteria, capture mode, live ownership and production/dev boundaries.
- [x] Run type, lint, format, unit/DOM, backend fixture checks and the complete browser suite; review the full diff.
- [x] Record measured results and report all remaining verification limits.

## Verification record

- Complete controlled browser regression: 32/32 passed, 55.2 seconds elapsed, 48.0 seconds summed test durations; previous local single-worker run was 35 cases in about 1.6 minutes. Production build is created and served by the test command.
- Three browser error branches moved to lower-level tests. Final web suite: 163/163 passed. Type checks, both project lints, repository format check, diff check and the development-resource lifecycle test passed.
- Final settings, history identity and capture-mode subset: 9/9 passed; seven requested successful PNGs produced. Default full regression produced no successful PNGs or retained traces.
- Four live smoke/SQL tests verified against the isolated controlled Aegra stack. A separate lifecycle probe verified successful exact-ID deletion and failed-test retention with an attached owned ID. No real model or daily development database was used.
- Independent whole-change review found one reporting defect: nonzero skipped-test time was omitted. Added a failing 15-second runtime-skip case, included all measured durations, and reran the complete web suite successfully. No other actionable findings.
- Both shards list 16 distinct cases and together cover the complete 32-case suite. Actual GitHub runner timing awaits a future authorized push. Runtime budgets remain advisory.
- No automatic commit or push.
