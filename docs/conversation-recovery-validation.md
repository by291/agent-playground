# Conversation recovery validation record

> Historical validation: results below belong to the dates in each section and include replaced routes/output formats. They do not describe current implementation or current test results. See [architecture](architecture.md), [conversations](conversations.md) and the [documentation index](README.md) for current behavior.

Date: 2026-09-27

## Scope

Aegra, the TypeScript server and web ran against isolated local PostgreSQL with deterministic mock-model workflows. Temporary services/databases were cleaned up after testing.

| Scenario                               | Result                                                                                                                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Single workflow review                 | Three cards before review and one afterward; reload recovered the form, four cards and final assistant text. Each pre/post-review run had separate AG-UI and Aegra IDs.               |
| Two parallel workflow calls            | One run produced two interrupts; submitting all responses completed both. Eight consecutive outputs retained six pre-review and two resume-run owners; reload produced no duplicates. |
| Browser disconnect/server restart      | Reload during a delayed mock-model run left Aegra executing. Restart during review resume recovered the final card and complete reply from persistent state.                          |
| Submission idempotency/unknown outcome | Identical submissions persisted once; `prepared` could be claimed once. `dispatching` without an Aegra thread became `submission_unknown`, readable but not claimable again.          |
| Output idempotency/order               | Repeated step keys returned original ID/sequence/run; conflicting payloads failed. Ten concurrent writes allocated consecutive output sequences.                                      |
| Aegra run mapping                      | `onRunCreated` saved mappings normally; missing mappings examined only the latest run. On a two-run thread, the latest ID matched and the old ID did not; no history scan.            |

`make check` passed seven Python/four server tests, Python/TypeScript type and format checks, and the web build. After directory refactoring, `make check` and server `/health` import checks passed again.

These checks did not use real DeepSeek output, cover Aegra-process crash recovery or measure production-load latency.

## Custom A2UI catalog (2026-09-28)

After switching to a custom workflow catalog, `make check` passed nine Python, four server and four web tests plus the build. Web checks covered registration/example correspondence, official `MessageProcessor` consumption and legacy Basic Catalog reading. PostgreSQL regression preserved old interrupted-card IDs/runs/payloads while new calls wrote version 2 and rejected conflicting version-2 content.

Browser `/a2ui` rendered `WorkflowPanel`, `WorkflowText` and `WorkflowSteps`, with keyboard access from chat. Runtime-equivalent `exclude_none=True` serialization of Python `experiment_card` passed Web parsing/processing and created a `WorkflowPanel`. Real Aegra/model execution was not rerun.

## Editable JSON previews (2026-09-28)

Examples became separate JSON files. The page displayed one component with bundled Monaco on the left and the same A2UI renderer on the right. `make check` passed nine Python, four server and seven web tests plus the build. Valid edits produced previews; invalid JSON/other catalogs could not replace them.

Browser checks covered selection, live valid edits, errors preserving the previous valid preview and keyboard reset. Edits were page-local rather than written to repository JSON. Monaco bundled locally without a CDN and loaded lazily with the preview route, not chat.

## Conversation A2UI runtime (2026-09-28)

At this stage output version 3 replaced old envelopes/events and Basic Catalog support. Earlier compatibility results above apply only to their recorded versions.

| Scope                                    | Result                                                                                                                                                                                                                |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Python workflows/PostgreSQL              | Ten tests passed; official `A2uiMessageListWrapper` persisted before `a2ui` events. Old versions were rejected, identical current outputs preserved identity, and conflicts failed.                                   |
| Official messages/conversation processor | Update-only batches, multiple surfaces, component/data changes, deletion, dynamic bindings, out-of-order queuing/recovery, duplicate snapshots, JSONB key ordering, identity conflicts and conversation isolation.    |
| AG-UI live subscription                  | Real `HttpAgent` consumed controlled SSE. Repeated subsequent output triggered one gap recovery; full snapshots did not rebuild surfaces. Invalid A2UI surfaced errors while text streaming continued.                |
| Processing/binding errors                | Failed batches hid affected surfaces and stopped processing. Invalid incremental/nested function-argument paths were rejected by official schemas before SDK callbacks could leave stale text.                        |
| Browser                                  | Controlled HTTP/SSE with the frontend verified bindings, deletion, reload, new-conversation clearing and unknown-component errors. Invalid preview components/paths preserved valid output; reset recovered examples. |
| Python → Web serialization               | Workflow-equivalent serialization passed official Web schemas/runtime and produced `WorkflowPanel`.                                                                                                                   |

Python and TypeScript type/lint/format checks, server/web tests and the build passed. Review findings for unknown preview components and swallowed binding errors gained regression coverage.

Real Aegra/model E2E was not rerun. Example workflows still created independent surfaces per step; controlled streams and the official resolver validated incremental handling. A2UI backend actions were not implemented.

## Responsibility and recovery boundaries (2026-09-28)

`make check` passed 17 Python, 13 server and 32 web tests, all three layers' types, lint/format checks and the build.

| Scope                      | Result                                                                                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run-state races            | Late creation callbacks retained terminal state; old mapping/state observations could not overwrite newer mappings or terminal states.                     |
| Atomic admission           | Prepared reviews retried the original request; historical paused runs did not block new turns after successful resume.                                     |
| Checkpoint synchronization | Terminal synchronization markers persisted; repeat reads did not request that checkpoint. Explicit ordering restored messages independently of timestamps. |
| Bounded mapping recovery   | Unknown submissions could be confirmed by the latest native run without resending or scanning history.                                                     |
| Frontend traces/resources  | Recovered output gaps did not mark submission traces as errors; preview replacement, invalid edits, reset and unmount released models.                     |
| Python output publication  | Persistence preceded events; failed writes did not emit. Retry retained initial identity/run ownership.                                                    |

An additional server-path check used temporary PostgreSQL/Redis, a real Aegra worker and a controlled workflow model. The first pause produced three outputs/one interrupt; review resume produced a fourth output and complete reply; a later normal message started another workflow. All three runs had matching AG-UI start/end IDs, consecutive output sequences and retained initial run ownership.

This round did not repeat browser visual checks, external-model calls or Langfuse ingestion. The real-worker check used a controlled model.
