# A2A collaboration demonstration

[Documentation index](README.md) · [Workflows](workflow-mechanisms.md)

## Run the example

Run `make setup` and `make dev`. Two additional independent Python processes serve the planner on port 2031 and the reviewer on port 2032. When adding this feature to an already running checkout, restart the development apps to load the new coordinator/tool. `make a2a` starts only the child services; `make a2a-stop` stops them. `make dev-stop` stops the apps and both child services. Child logs are in `.dev/a2a/`.

Choose **Collaborate with agents** on the welcome screen and send the prepared request, or send:

> Use run_a2a_workflow to plan, review and revise an order analysis proposal.

The existing conversation agent starts a durable coordinator, which delegates work to independent planner and reviewer processes through the official A2A Python SDK. The coordinator sends your request to Planner, sends Planner's draft to Reviewer, and returns the draft plus Reviewer's actual feedback to Planner for revision. Planner's revision is a new task in its existing context. The child agents communicate through the coordinator in this example.

The conversation shows a three-step timeline with each delegation, purpose and status. The active output expands as text arrives; completed drafts and reviews collapse and can be reopened. The final revision stays expanded and renders Markdown headings, lists, tables and code blocks. Failed or cancelled collaborations retain their last partial output. A compact durable workflow receipt records completion without copying the full proposal into another card. Previously saved numbered result cards are hidden only when they exactly duplicate the matching completed revision; stored output and presentation ownership remain intact.

For the multi-turn input example, ask:

> Use run_a2a_workflow with require_input=True to demonstrate an agent requesting additional information.

The planner returns A2A `input-required`. Enter the requested information in **Additional information** and choose **Continue agents**. The ordinary composer stays disabled while the collaboration owns the workflow. **Cancel agents** requests cancellation of outstanding remote work; the UI waits for the confirmed outcome. Cancellation retains existing child output. A cancellation racing a completed collaboration can return a conflict and the next snapshot restores the actual result.

## Configuration

The child agents read the root environment, just like the Python application. Model mode is the default and uses the root DeepSeek model/key settings. Child calls disable thinking and budget 2,200 answer tokens so the bounded demonstration produces visible text promptly. `A2A_DEMO_MODE=scripted` supplies deterministic, progressively streamed example paragraphs for protocol demonstrations and controlled checks. Scripted content is an example rather than model-generated analysis.

| Root setting       | Default                          |
| ------------------ | -------------------------------- |
| `A2A_PLANNER_URL`  | `http://127.0.0.1:2031`          |
| `A2A_REVIEWER_URL` | `http://127.0.0.1:2032`          |
| `A2A_DEMO_API_URL` | `http://127.0.0.1:2026/a2a-demo` |
| `A2A_DEMO_MODE`    | `model`                          |

The TypeScript server independently accepts `A2A_DEMO_API_URL` in `server/.env`; its default follows its own `AEGRA_URL` plus `/a2a-demo`. It never reads the root `.env`. Custom remote agents must implement the SDK task/message conventions and the demo's bounded text output contract. A child can be launched separately with `uv run --env-file .env python -m agent_playground.services.a2a.server --role planner --port 2031`.

Each child publishes `/.well-known/agent-card.json` and a JSON-RPC endpoint. This local demo uses A2A 1.0 with streaming tasks and text artifacts. The child endpoints are development services without per-user authentication; keep them on trusted development interfaces. Coordinator submission uses `WORKFLOW_API_TOKEN`. Input/cancel forwarding uses the private task callback token, which public conversation snapshots never expose.

## Ownership and recovery

`services/a2a/agent.py` owns child model execution, `server.py` exposes official A2A types/routes, and `db/a2a_tasks.py` persists remote task snapshots and stable request identities. `services/a2a/coordinator.py` follows streams and posts application snapshots; `db/a2a_jobs.py` persists coordination stage, outputs, control requests and worker leases. Services do not depend on workflow orchestration. `workflows/a2a/` registers the external wait and publishes the final result. The existing TypeScript conversation layer saves updates and resumes the parent workflow.

Browser disconnects and conversation switches do not cancel remote tasks. Saved snapshots contain accumulated child text, so refresh restores text without reappending old chunks. The backend owns task subscriptions and continues delivery without a browser. Output snapshots replace prior text; A2A artifact chunks use official append/replace semantics. Model tokens are coalesced before publishing, and historical progress rows omit repeated full output text.

Coordinator restart reclaims expired job leases, queries the original remote task and follows its existing stream or saved result. Stable message IDs prevent transport retries from creating extra work. Replays reuse the saved user message so later prompt edits cannot change an already reserved request. Child restart preserves completed tasks and input requests. An unfinished generation restarts within the same task, replacing its partial artifact before appending new text. This preserves task identity but does not promise token-perfect continuation of a model invocation. Completed/cancelled/failed tasks remain terminal; revision creates a new task.

The demo runs at most four coordinator jobs per process, three child stages per collaboration, and 100,000 output characters per stage. It provides bounded planning/review/revision rather than an unrestricted agent negotiation loop. Both the web client and [native Android client](../android/README.md) display live child Markdown, three-step handoffs and clarification/cancellation controls. Android connects to the same TypeScript server; agent execution and persistence remain on the backend.

## Verification

Python tests use isolated PostgreSQL and real official-SDK HTTP services to check chunks, replay, clarification, cancellation, restart and coordinator reconnect. TypeScript checks cover callback validation, credential exclusion, history size, controls and background continuation; DOM/browser checks cover semantic Markdown rendering, handoff expansion, live replacement, duplicate suppression and reload restoration. Android JVM and Robolectric checks cover snapshot contracts, HTTP controls, request ownership, stale snapshot recovery, clarification polling, native Markdown and timeline/control behavior. Controlled checks do not establish live-device behavior or the quality or availability of a live model provider.
