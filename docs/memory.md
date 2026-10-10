# Agent memory

[Documentation index](README.md) · [Conversations](conversations.md) · [Architecture](architecture.md)

## Default behavior

Long-term memory is enabled in the normal Python Agent graph. No feature flag,
separate service or visit to `/memory` is needed. Web and Android conversations
use the same server-side memory. The Web **Memory** sidebar entry opens a page
for inspecting, correcting and forgetting saved entries.

The agent can save explicit durable preferences, confirmed project facts and
decisions during a conversation. Examples:

- “Remember that I prefer concise answers with concrete examples.”
- “For the Playground project, remember that we use PostgreSQL and pnpm.”
- “Correct the Playground database choice to PostgreSQL.”
- “Forget my preference for detailed answers.”

Preferences are automatically loaded before each model call, including calls in
new conversations. Project facts require an explicit project name. The agent
uses `search_memory` to recall that project's facts; searching or saving project
memory selects it for subsequent automatic recall in that conversation. A new
conversation has no selected project. If parallel tools name multiple projects,
the last project command in tool-call order determines subsequent recall.

Project names are trimmed and case-folded for storage identity; `Playground` and
` playground ` refer to the same project. Different names have independent
namespaces. The agent is instructed to search again when the user switches
projects, and to search before correcting an existing fact instead of creating
contradictory entries.

Current instructions take priority over remembered preferences. Saved entries
are reference data and do not grant tool permissions. Transient requests,
speculation, credentials and facts supplied only by documents or tools should
not be saved. Capture runs through the normal conversation tool loop. There is
no background extraction job or separate extraction-model request.

## Inspect, correct and forget

The Memory page lists preferences and project facts with their update date and
source conversation when available. **Correct** changes the text while retaining
its scope and source. **Forget** asks for confirmation and removes the entry from
future recall. Existing conversation messages and historical checkpoints retain
their original history; forgetting does not erase a conversation or interrupt a
model call that has already started.

Every edit and deletion submits the revision that was displayed. If another
instance changes the entry first, the request returns a conflict. The correction
dialog keeps the draft and requires review of the latest saved version before
retrying. The deletion dialog similarly requires review of the latest text.
Both dialogs offer refresh recovery if the latest version could not be loaded.

The application currently has one shared workspace without per-user
authentication or tenant ownership. Its memories are shared by everyone using
that workspace, just like shared knowledge. Per-user memory would require a
trusted identity boundary before introducing user namespaces.

## Storage and consistency

Python owns memory contracts, tools, recall and persistence in
`agent_playground/memory/`. Aegra supplies its existing LangGraph
`AsyncPostgresStore` to the graph; LangMem's management tool writes validated
records. Aegra prepares the Store tables at startup in its configured database
and schema. No application-table migration, embedding model or new infrastructure
is required.

The namespace root is `("agent_playground", "memories", "shared")`.
Preferences append `"preferences"`; project facts append `"projects"` and the
SHA-256 hash of the normalized project name. Records contain a UUID, category,
optional project, text, source thread/message IDs, positive revision, creation
time and update time. Source IDs come from the tool runtime rather than model
arguments. Management edits retain them.

Application mutations acquire a PostgreSQL advisory transaction lock per
namespace and record, covering the complete read, revision check and Store
write. Locks use short-lived connections to `database.aegra_url`, released after
each mutation, with five-second connection and lock-acquisition timeouts. Agent
workers and management requests share this protocol across instances.

New entries derive their UUID from the conversation and tool-call IDs. A replay
of the same creation returns the existing entry. Forgetting replaces the Store
value with a content-free tombstone and increments its revision; replaying the
old creation cannot restore the forgotten content. Remembering the fact again
requires a new tool-call identity. Tombstones have no expiration in this version.

Recall uses scoped Store search without an embedding index, considering up to
100 recent entries per scope. The search tool returns up to 20 entries, defaulting
to 10. Automatic context includes at most 1,024 approximate tokens, newest entries
first. Single entries are limited to 1,000 UTF-16 code units and project names to
100; source IDs are limited to 256. Large memory collections do not yet have
semantic search or automatic consolidation.

Recalled entries are appended to the model's system message rather than the
archived transcript. Context compaction reserves their budget and reports their
actual approximate usage under system tokens. The checkpointed recall cache
and project selection are excluded from graph input and public output; native
Aegra checkpoint inspection still exposes checkpoint state. If recall is
temporarily unavailable, the normal model call continues without memory and
Python logs that recall failed.

## Management API

The TypeScript server exposes these endpoints:

| Method and path | Request | Response |
| --- | --- | --- |
| `GET /api/memories` | Optional `offset` and `limit` | `{items, nextOffset}` |
| `PATCH /api/memories/{id}` | `{category, project, revision, text}` | Updated memory |
| `DELETE /api/memories/{id}` | `{category, project, revision}` | `204` |

Preferences use `category: "preference"` and `project: null`; project facts use
`category: "project"` and a nonempty project name. Pagination defaults to offset
0 and limit 50, supports limits 1–100 and offsets 0–1,000,000. IDs must be UUIDs
and revisions positive safe integers. Invalid public requests return `400`;
missing records return `404`, stale mutations `409`, and upstream unavailability
`503`. Repeating a completed deletion returns `204`.

The server proxies Python `/memory` endpoints using its own
`WORKFLOW_API_TOKEN`. It must match `workflow.api_token` in the private
`agent.yaml`, as with other internal application requests. The browser receives
no private credential. Proxy requests have a five-second timeout, respect
cancellation, reject redirects and return sanitized errors with `no-store`.
Python validates direct private requests and returns `422` for malformed input.

## Verification

Python checks exercise actual LangMem writes, cross-conversation graph recall,
explicit project selection, checkpoint restoration, parallel tools, private
input/output state, context budgets, management validation and retry fences.
An isolated PostgreSQL test opens independent Stores, races revision updates
and verifies deletion after reconnecting.

TypeScript tests cover schemas, authenticated proxying, request bounds and error
handling. Web DOM checks cover draft preservation and conflict/refresh recovery.
The controlled browser regression uses the real Python management routes,
LangMem and PostgreSQL through the real public server to verify source navigation,
correction, reload and forgetting. These controlled checks establish mechanics;
they do not establish a live model's memory-capture quality.
