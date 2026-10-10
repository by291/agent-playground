# Conversations

[Documentation index](README.md) · [Architecture](architecture.md)

## Drafts and the first submission

`/` opens a blank draft. Opening the page, clicking **New conversation**, typing or selecting attachments does not allocate a thread ID or fetch a snapshot. The first valid submission allocates the ID and promotes the URL to `/c/<threadId>` without replacing the mounted session. Choosing a different model also allocates the local ID and promotes the URL so the choice survives reload; the conversation enters history only after admission. Selected attachments upload at submission, before sending the message. Upload retries reuse the same thread and file IDs; later turns use the same conversation ID.

A conversation appears in history only after its first message is admitted. Its initial title comes from that message, limited to 100 Unicode characters. Welcome suggestions prepare an editable draft; only sending starts the run. Switching conversations resets unsent drafts and unsubmitted review edits.

Attachment upload intents can reserve server-side storage before message admission; those reservations do not appear in history. Previously archived message-only conversations remain visible even when they have no run record.

The composer retains text and selected attachments until admission is confirmed. Upload, validation and critical local-journal failures leave the input available for correction or retry. SQL review feedback over 10,000 characters reports a validation error and preserves the draft.

For image questions, attach JPEG, PNG, GIF or WebP files and describe what to inspect. Regular chat sends their pixel data to the configured model; the default `deepseek-flash` supports image understanding. Web and Android use the same server path. Each message can include at most four files, up to 10 MiB each, with images totaling at most 32 MiB and dimensions at most 8192 pixels per side. Image formats are identified from file contents and pixels are decoded before admission. Unsupported, truncated or unrecognized images are rejected while preserving the draft. Workflow review feedback currently accepts text; image attachments there report a validation error.

The chat archive and retry journal retain file references. Image pixels remain in the agent checkpoint for follow-up questions until context compaction replaces older history with a text summary. Summaries retain discussed findings rather than the original pixels. DeepSeek's 48 MiB request-body limit also applies to the accumulated image history; use smaller images or a new conversation when many large images exceed it. Image generation, audio/video input and OCR for shared knowledge documents are separate capabilities.

Web and Android display attached files separately from message text, including older saved messages. Selected images have local previews before upload; sent images show thumbnails that open a larger preview. File names and download actions remain available when preview loading fails. The server decodes supported raster images into oriented WebP previews (320 pixels per side for thumbnails, 2048 for larger previews); animated files show a still preview. Downloads retain the original bytes. Previews use the same conversation access and deletion checks as downloads and are served without HTTP caching.

The Android image viewer uses a dark full-screen gallery for images in the same message or composer selection. Swipe horizontally between images at fit scale, pinch or double-tap to zoom, and drag a zoomed image within its bounds. Tap once to show or hide the controls. Swipe down at fit scale, use the close control, or press Android Back to return to the conversation. Zoomed and multi-finger gestures move the image without dismissing the viewer; each new page starts fitted to the screen.

The Web image viewer also groups images from the same message or composer selection in a dark full-screen gallery. Use navigation arrows, the thumbnail strip, or the left/right arrow keys at fit scale to switch images. Zoom with the toolbar, mouse wheel, double-click, or touchscreen pinch; drag to inspect a zoomed image and use the fit control to reset. Small images can be magnified beyond their native size. Escape and the close button return focus to the selected attachment. Reopening starts at the clicked image with zoom reset, and preview failures retain the original download action.

The Web gallery uses Yet Another React Lightbox inside the existing modal. Its pnpm-managed patch requires a previous pointer press before recognizing a double-click and keeps pinch and drag gestures out of double-tap history. Retain the native-pointer browser regressions when updating this dependency; remove the patch when the upstream detector includes these fixes.

Mouse-wheel zoom uses small continuous steps and frame-based interpolation around the cursor. Reversing the wheel responds from the displayed scale; direct input and control activation, image changes, and closing the viewer cancel pending interpolation. Reduced-motion preferences apply the wheel scale immediately.

## History and management

The sidebar orders conversations by their latest submission, loads older pages at the end and provides explicit retry, rename and delete actions. Opening a saved row restores its transcript, tool process, outputs, pending review and external tasks. Copy `/c/<threadId>` to open a saved discussion in another browser with access to the same server. Refresh, Back and Forward restore the addressed conversation; `/` continues to mean a blank draft. A production web server must serve the SPA entry point for `/c/*`.

| Endpoint                               | Behavior                                                                                                                                     |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /conversations`                   | Pages of 30 summaries with an opaque `nextCursor`; pass it as `cursor`.                                                                      |
| `GET /conversations/:threadId`         | Persisted messages, runs, outputs, interrupts, external tasks and context usage.                                                             |
| `GET /conversations/:threadId/events`  | Snapshot invalidation SSE; reconnect emits `ready` and refetches saved state.                                                                |
| `PATCH /conversations/:threadId`       | Rename with `{ "title": "..." }`.                                                                                                            |
| `PATCH /conversations/:threadId/model` | Save an available conversation model; active, paused and external work reject switching.                                                     |
| `DELETE /conversations/:threadId`      | Soft-delete a conversation; return `204` or reject active/unconfirmed runs with `409`.                                                       |
| `DELETE /conversations`                | Atomically clear the selected saved history, including unloaded pages; any active/unconfirmed latest run rejects the whole batch with `409`. |

Deletion hides the conversation and prevents new submissions/recovery, retaining run/message records, workflow outputs and Aegra checkpoints. Completed, failed and paused conversations may be deleted. Concurrently created conversations outside a clear-history batch are unaffected. Conversation-file access is revoked immediately and S3 cleanup follows separately; shared knowledge documents are not deleted. These operations affect the current shared workspace, without per-user ownership.

## Recovery

Switching conversations detaches the local stream while the Aegra run continues. Local storage keeps unconfirmed submission identity and empty hints by thread, allowing admission recovery without resending. The list refreshes on accepted runs, recovery, focus and explicit refresh rather than continuously polling.

Retries preserve the original operation identity while admission is uncertain. A definite `400`, `404`, `409` or `413` rejection can release that identity after a fresh snapshot confirms that the run was not admitted, allowing edited input or a current review response. A network error or `5xx` response requires reconciliation before another operation can replace it.

Each conversation has its own Zustand store. Components subscribe to the fields they display, while `HttpAgent` manages the AG-UI stream. TanStack Query fetches and caches server snapshots by thread ID and refreshes after a run ends or the page regains focus. Newly created conversations accept input immediately and enable snapshot fetching after their first submission settles; restored conversations wait for an initial snapshot before accepting input. Two-second polling is enabled only for recovery while the page is focused: unfinished or unknown server runs without a live local stream, failed snapshot requests, a finished local run not yet present in the snapshot, or missing saved A2UI output. Idle conversations and healthy local streams do not poll. Saved conversations subscribe to `/conversations/:threadId/events`; PostgreSQL notifications invalidate their snapshot. SSE reconnect sends `ready` and fetches the full persisted state, and switching conversations closes the previous subscription. Snapshot requests are cancellable. The gateway health indicator refreshes every 30 seconds. The browser persists the thread pointer, an unconfirmed submission and an empty-conversation hint. A new or known empty conversation renders its welcome page immediately on reload; other conversations show a message skeleton while history recovers.

If upstream run creation is unconfirmed, the server checks only the newest Aegra run on the thread. A creation request still owned by the server remains `dispatching` while that request is in flight. Once the request settles without a confirmed mapping, or its owning process restarts, an unconfirmed mapping becomes `submission_unknown`; the UI does not blindly resend. Later recovery can establish that mapping, but a persistently unknown submission needs manual reconciliation. Upstream/database failures return `503`; invalid input and admission conflicts return `400` or `409`.

The SDK does not automatically repeat run-creation requests after a transport error. PostgreSQL change notifications use one shared listener per server process; each stream receives only its conversation's changes. Connection loss closes affected streams, and their normal reconnect/refetch behavior restores saved state.

Snapshots recover saved results rather than every historical AG-UI event. Current output format and legacy compatibility are described in [architecture](architecture.md#a2ui-output-and-presentation).

## Tools, Skills and sources

Ordinary tools and Skills use the same compact execution-header style, distinguished by their **Tool** or **Skill** label. Skill calls are grouped by Skill name; a single ordinary tool shows its name, and multiple ordinary calls show a count. Expanding a process reveals accompanying assistant text, paths, execution status, parameters and raw results. Failures remain visible while collapsed. User-opened processes stay open when execution finishes; workflow cards and review forms remain directly accessible.

Tool calls and results are archived as official AG-UI messages, including assistant messages with only tool calls. The Python checkpoint keeps public messages recoverable across compaction and review resumes. Reload restores a collapsed process; missing metadata in old text-only history is not reconstructed from prose.

Live tool results must carry the model's tool-call ID, either in a LangGraph `ToolMessage` or in a `Command` containing tool messages. Internal tool invocations, such as LangMem's write operation inside `remember_memory`, can return plain values without that ID; the server excludes those completion events from public tool conversion. The outer tool result determines execution status, while handled tool errors remain visible during the model's fallback reply.

[Skill outputs](skills.md#attachments-and-outputs) appear as downloads. [Knowledge citations](knowledge.md#answer-citations-and-original-passages) appear as numbered footnotes that open their corresponding retrieved excerpt.

## Reply presentation and reasoning

Live assistant text uses a display buffer adapted from assistant-ui's smoothing scheduler, with a base rate of 60 characters per second, a 2.5-second adaptive backlog drain target, and at most about 30 display updates per second. The buffer continues draining for up to about 2.5 seconds after the model finishes; stored messages and run status retain the full received output. Restored history and tool commentary render immediately. New text uses Streamdown's native 500ms opacity fade with Unicode word segmentation. Only the current Markdown block animates, and older text in a long paragraph sheds its token spans so animation elements do not grow with the whole reply. The composer stays disabled until buffered text and the final fade settle. This presentation state is local to the UI and does not delay the persisted run status. Reduced-motion preferences disable both the display buffer and fades. The transcript follows new output while the reader is at the bottom, preserves the reading position when scrolled up, and offers a scroll-to-end button.

When the agent emits readable reasoning, the chat shows it in a **Thinking** / **Reasoning** fold beside the tool process. It opens during the active reasoning phase and folds when the first answer text is displayed, including when reply animation is enabled; an empty text-start event does not fold it. You can reopen it while the answer continues streaming, and later answer updates keep that choice. A live run that ends without an answer leaves its reasoning open. Restored replies start folded. Checkpoint recovery preserves DeepSeek `reasoning_content` and textual reasoning/thinking blocks as separate AG-UI reasoning messages for newly archived answers. Previously saved answers are not backfilled into a later turn; internal summarization messages and encrypted thinking are excluded. Models that do not emit reasoning keep the existing waiting indicator.

## Navigation and preferences

Long-term Agent memory is enabled in normal chat. Preferences carry across conversations; project facts require an explicitly named project. The **Memory** sidebar entry opens the saved-entry management page for inspection, correction and forgetting. See [Agent memory](memory.md) for scope, consistency and limits. Browser display preferences below remain local settings.

The chat workspace uses a neutral graphite theme with a collapsible desktop sidebar. Its default width is 320px; drag the right edge or use the separator's arrow keys to adjust it between 240px and 420px. The browser remembers both the chosen width and whether the sidebar is collapsed. Width changes follow the pointer directly. Collapsing and expanding coordinate the sidebar width, labels, and buttons with a short transition that respects reduced-motion preferences. Conversation content and the composer share a centered column up to 896px wide, with assistant avatars in the left gutter. Markdown code blocks include syntax highlighting and a compact toolbar for copying or downloading the original source. On smaller screens, the navigation button opens a modal drawer that can be closed with its close button, Escape, or the backdrop. Changing the sidebar layout preserves composer drafts and review edits. Welcome suggestions prepare an editable draft; sending the draft starts the run. Connection status lives in the sidebar, development tools remain in the header, and the context ring sits beside the send button with the configured model name.

The settings button beside the gateway status opens workspace preferences on desktop, collapsed navigation and mobile. Choose Light, Dark or System appearance, Enter or Ctrl/Cmd + Enter to send, and whether replies use the paced reveal and fade. Shift + Enter always inserts a new line, and composition input does not submit. Reply animation continues to respect the system reduced-motion preference. Changes apply immediately and are saved in this browser; resetting preferences leaves conversations and navigation layout intact.

Settings also provides **Clear all conversations**, which opens a separate confirmation dialog above settings and explains its shared-workspace scope. Cancel, Escape or clicking its backdrop returns to the unchanged settings window. Success closes only the confirmation dialog, keeps settings open and opens a fresh conversation behind it, while clearing cached snapshots and browser conversation pointers and preserving preferences and navigation layout. A rejected request leaves the current discussion and history intact and displays the server's reason in the confirmation dialog. Cleared conversations cannot be restored through the app.

## Model context

### Compaction

The agent uses LangChain's `SummarizationMiddleware` to compact older messages automatically when estimated context usage reaches 80% of the model window. It retains recent messages within a 20% token budget, preserving tool-call/result pairs, and replaces earlier history with a summary saved in the checkpoint. The summarization call receives all selected history without the middleware's default 4,000-token truncation. It uses the selected conversation model with thinking disabled and a 4,096-token output limit; summary failures propagate without replacing history. A single oversized turn that still exceeds the window after compaction is rejected rather than silently truncated.

The root `models.yaml` optionally configures `chat.compact_ratio` (default `0.8`, greater than `0.2` and less than `1`). Each entry under `chat.models` uses the same optional `thinking` level (`disabled`, `low`, `medium`, `high`) and input/output budget overrides. When omitted, thinking is disabled and budgets come from normalized model information. The effective input budget accounts for thinking mode, caps history at the provider input limit and reserves output within context capacity. Unknown models require complete library metadata or a verified registry entry; budget overrides cannot substitute for missing model capacities. Changing these settings requires restarting the agent. See [model selection](model-selection.md) for provider settings, Web and Android selectors and fixed-model recovery rules.

### Usage indicator

The model control beside the send button opens estimated token usage and a breakdown of system instructions, tool definitions, conversation messages (including tool-call arguments), tool results, and summaries. Counts use LangChain's approximate counter with a conservative two-character-per-token ratio; they are estimates, including for Chinese text, rather than an exact tokenizer or billing measurement. Provider-reported input tokens from the last model request are shown separately when available. Usage refreshes at model boundaries, so text still streaming and unsent composer input are not yet counted. The model name is available before the first turn through a read-only `GET /agent-info` route: Python reads the same configuration as the graph, and the TypeScript server forwards that metadata. Stored usage from a different model is hidden until the current model reports fresh usage.

### Checkpoint history and public transcript

The browser sends only the newest user message for a normal turn. Aegra's checkpoint owns model history; archived chat is not reintroduced after compaction. The complete public transcript is kept separately in the application database. Internal summaries and compressed message snapshots do not replace that transcript. Current-run replies are kept in checkpoint state until synchronization so compaction during a tool loop cannot erase recoverable replies. Context usage is synchronized with the latest finished or interrupted checkpoint and recovered after reload without extra upstream reads on every poll.

## Direct AG-UI request

The web app uses `POST /agent`. An API client may submit the official AG-UI input directly; use fresh run/message IDs for a new submission and reuse a saved thread ID for later turns. The native Aegra Agent Protocol is separately available at `POST /runs/stream` on port `2026`.

```sh
curl --no-buffer -X POST http://127.0.0.1:3000/agent \
  -H 'Content-Type: application/json' \
  -H 'Accept: text/event-stream' \
  -d '{
    "threadId": "8af32af0-715d-47be-a4a2-0678a532e5da",
    "runId": "b50da20d-b907-43dd-a284-d88995796b9e",
    "messages": [{"id": "2e455cc4-7507-4c9e-95f9-a785e08c5abb", "role": "user", "content": "What time is it now?"}],
    "tools": [],
    "context": [],
    "state": {}
  }'
```

The built-in `get_current_time` returns UTC time. The local MCP server supplies `calculate_sum`; try **"Use the MCP tool to add 12 and 30"**. Other capability tools are documented in [workflows](workflow-mechanisms.md), [Skills](skills.md) and [knowledge](knowledge.md).
