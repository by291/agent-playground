# SQL review workflow

Preserve the experiment workflow and add a SQL workflow using the existing LangGraph tool/subgraph, AG-UI resume and durable A2UI output paths. The user approved this design and requested implementation on 2026-10-04. Repository instructions permit proceeding after clarifying key requirements; no additional approval stages are required for this simulation.

Fetch an initial SQL and schema through a local demonstration HTTP API, check it through another API, and automatically request one agent revision when the initial check fails. Recheck the revision, then pause. Every subsequent user message resumes this workflow and permits explanation, clarification or revision. Changed SQL gets a new revision and a new check; explanations retain the revision. Every pause gets its own review round and persisted output identity. Acceptance submits exactly the current checked revision; failed checks cannot be accepted. Abandonment never submits.

The demo API uses a fixed orders schema and deterministic SQL generation. SQL parsing and schema checks use sqlglot and are explicitly demonstration checks, not a production database validation service. Submission records SQL and returns a durable, idempotent receipt without executing SQL. Unknown submission outcomes are reconciled using that same receipt key.

Python owns API clients, business graph, structured agent revision and output publication. The conversation layer owns admission and message archives. The frontend routes SQL feedback through resume, keeps normal messages visible and exposes accept/abandon actions. Experiment reviews remain unchanged. One active SQL workflow is the supported interactive path; mixed/parallel interrupts must remain visible and must never enable ambiguous composer routing.

Use independent graph nodes for external calls, publication and interrupts. LangGraph checkpoints own business state; A2UI outputs own durable presentation and SQL-agent reply text. Stable reply IDs allow live and recovered replies to deduplicate. Record SQL feedback as ordinary archived user messages during resume admission, without injecting an ordinary turn into the paused parent agent.

Verify fetch/check/revision/pause/submit transitions, explanation-only messages, rejected failed and stale acceptance, abandonment, graph recreation, duplicate submission, real HTTP API contracts, frontend interaction and reload, and the existing workflow regression suite. Controlled-model tests prove workflow behavior; a separate live smoke proves real model integration.
