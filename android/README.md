# Agent Playground for Android

A native Jetpack Compose client for the existing Agent Playground server. It runs the same conversations, Skills, SQL/experiment/report workflows, A2A collaborations and shared knowledge and memory management as the web client.

## Build and run

Open this directory as a project in Android Studio. Use JDK 21, Android SDK **37.1**, and the checked-in Gradle wrapper. Runtime support starts at Android 8.0 / API 26. The current AndroidX A2UI alpha renderer requires SDK 37.1 and pulls Compose 1.13 alpha runtime/UI dependencies; it is isolated in `feature/conversation/` under `ui/workflow/`.

```sh
cd android
# Set JAVA_HOME to your JDK 21 installation.
# Set ANDROID_HOME, or create an untracked local.properties with sdk.dir.
./gradlew qualityCheck
```

In PowerShell, run `.\gradlew.bat qualityCheck` instead. The repository-root `make android-*` commands select the native wrapper automatically.

The debug APK is `app/build/outputs/apk/debug/app-debug.apk`. The wrapper uses Gradle 9.8.1 with AGP 9.4.1. Kotlin 2.4.21's [published fully tested range](https://kotlinlang.org/docs/gradle-configure-project.html) ends at Gradle 9.7.0 and AGP 9.3.1; this newer combination is verified with the repository's `qualityCheck` task. Review that check when changing any toolchain version.

Start the existing backend with `make dev` from the repository root. In the app's **Settings**, connect to the TypeScript server:

- Android emulator: `http://10.0.2.2:3000/` (default).
- Physical device: `http://<computer-LAN-address>:3000/`, with both devices on the same network.
- USB development: `adb reverse tcp:3000 tcp:3000`, then connect to `http://127.0.0.1:3000/`.

Connect to port **3000**, not Vite or Aegra. Connection checks `/health` and `/agent-info`. Debug builds allow HTTP for local development; release builds require HTTPS. Model and storage credentials remain on the backend. This client follows the server's current shared-workspace model without adding an authentication protocol.

On Android 17 / API 37 and newer, the app requests **Nearby devices** (`ACCESS_LOCAL_NETWORK`) before connecting to an emulator host alias, LAN address or local hostname. Allow it on first launch to use the default server. If denied, Settings stays available for retrying or choosing another server; **Open app permissions** opens Android settings for restoring a denied permission. Then tap **Connect and save**. Internet servers and loopback connections such as `adb reverse` do not require this permission. Android 16 and earlier retain the existing connection flow.

If the emulator cannot reach the host alias, run `adb reverse tcp:3000 tcp:3000` and connect to `http://127.0.0.1:3000/`. Repeat the reverse command after restarting the emulator. Android Studio does not need to remain open: use `emulator -list-avds` and `emulator -avd <name>` from the installed SDK to launch an existing device.

## Feature mapping

| Web capability       | Native client                                                                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Chat and Markdown    | Streaming replies, automatic initial positioning and optional following, jump to latest, syntax coloring, selectable Markdown, code/table copy, links and preserved drafts.          |
| Conversation history | Automatic pagination, current-thread fallback, refreshed titles/run status, pending mutation guards and explicit delete/clear confirmation.                                          |
| Models               | Conversation-level DeepSeek/Qwen picker; disabled unavailable options, server-owned choices, local new-thread selection and model-specific context details.                          |
| Recovery             | Server snapshots after streams and on reconnect; a per-server/thread journal retains pending admissions.                                                                             |
| Reasoning and tools  | Phase-aware reasoning, paired tool arguments/results and execution status, grouped Skills and output downloads; separate live activity page.                                         |
| Workflows            | Official Compose A2UI runtime with WorkflowPanel, WorkflowText, WorkflowSteps and WorkflowSql; earlier presentations remain expandable.                                              |
| Human review         | Editable plans with immediate single decisions and explicit final confirmation for multiple plans; workflow accept/abandon and conversational feedback with revision/round identity. |
| Reports              | External task status, progress, errors and history; server-owned continuation survives client absence.                                                                               |
| A2A collaboration    | Three-step draft/review/revision handoffs, live child Markdown, expandable intermediate results, clarification input and confirmed cancellation.                                     |
| Files                | System document picker; four attachments per message, 10 MiB each; system save dialog for outputs/originals.                                                                         |
| Knowledge            | Validated TXT/Markdown/text PDFs; original-ID upload retry/resume after restart; status/chunks/errors, reindex, confirmed delete and save original.                                  |
| Memory               | Paginated shared preferences/project facts, source conversation navigation, correction and confirmed forgetting with revision-conflict review.                                       |
| Sources              | Reply-scoped numbered citations; a partial bottom sheet expands to full height, with exact passage navigation, PDF page and original-document download.                              |
| Preferences          | Light/dark/system theme, reply animation and hardware keyboard send shortcut.                                                                                                        |

The web-only Monaco/A2UI development gallery and browser telemetry bootstrap are not Android screens. There is no client-side agent execution, offline execution or background Android worker. A2A tasks expose the existing server's input/cancel controls; ordinary conversation runs have no cancellation control. Leaving the app does not cancel the server run. Streaming observation recovers from snapshots rather than a durable event replay log. Reply animation controls one-time entrances for new messages/review/task cards and smooth jumping to the latest message. Streaming text updates and restored history remain immediate; the client does not reproduce the browser's text-draining animation.

## Interface

The client uses white and graphite surfaces, restrained blue accents, scalable typography and matching light/dark themes. Launcher, monochrome and drawer branding reuse the project's stack mark. User messages have a stronger neutral bubble with a compact trailing corner. Chat has a compact header and an integrated composer. Folded reasoning and tool rows form a compact stack with full-height touch targets. Reasoning uses a lightweight disclosure row with a left rail for expanded notes. It preserves manual folding and collapses only after visible answer content arrives. Ordinary tools in the same reply share one collapsed summary; Skills are grouped separately by name, and memory operations have their own group. Tool, Skill and Memory rows show a category, name and execution status; each call has its own disclosure for parameters and results. Group and call expansion survive appended calls, and failures remain visible with the group collapsed. Payloads preserve selectable content; large values scroll within their detail pane.

User and agent messages show their date and time below the content in the device's local timezone. Saved timestamps come from the server archive (workflow replies use their output publication time); live messages use submission/event time until synchronization. Older servers without timestamp metadata leave dates hidden. Each agent answer has a Copy all icon below it that copies that message's original Markdown, including code and tables. Copy is disabled while the turn is running, and a checkmark confirms success. Footer controls and timestamps are excluded from text selection.

Markdown replies use a shared Compose selection container: long-press and drag across paragraphs, headings, lists, quotes, code and table cells, or use Select all to copy the reply. Selection copy defaults to Markdown. Select all preserves the original source, including code fences, table syntax and reference definitions; partial selections retain inline formatting and add the required code/table syntax without including unselected words or cell contents. Language/table headers and copy controls are excluded from selection; table column headers remain selectable. Paragraph spacing applies between rendered blocks; source blank lines and link definitions add no extra leading or trailing gaps. Rendering uses Multiplatform Markdown Renderer with themed typography and quotes, compact monospace inline code, syntax-highlighted code panels, and horizontally scrollable tables with rich-text cells. Inline code uses the theme's secondary text color without a filled background or added spacing. Long code-block lines scroll horizontally. Dedicated code/table copy preserves the original code or tab-separated table data and remains disabled during streaming. Starter prompts populate the draft for editing before sending.

A2A task panels show the draft, review and revision handoffs with their purpose and status. The Coordinator dispatches each handoff through independent Planner and Reviewer services. Active child output expands as accumulated Markdown snapshots arrive; completed intermediate steps collapse, final revisions stay open, and failed/cancelled tasks retain their latest partial output. Manual expansion survives progress updates. Matching old numbered result cards are omitted from the conversation display once the completed revision is available, while stored outputs and presentation ownership are preserved.

When an agent requests clarification, enter **Additional information** and tap **Continue agents**. **Cancel agents** requests server cancellation; neither control optimistically changes the task status. Controls share a pending guard and show local errors for retry. The session owns requests and cancels them when switching conversations or disposing the ViewModel. SSE change notifications and foreground recovery polling refresh child snapshots, including clarification waits; stale revisions cannot replace newer output or terminal continuation state.

After the child stages finish, the server resumes the parent workflow to publish its receipt and final reply. This normal background continuation shows **Agent is completing the workflow…**, even without a direct client output stream. Other healthy observed runs show **Agent is working…**; recovery feedback is reserved for reported errors, missing outputs or an uncertain submission.

The history drawer on phones and the persistent sidebar on wide screens follow the web workspace hierarchy: New conversation, Knowledge and Memory above conversations, with the configured server and a Settings control in the footer. The current conversation, including an unsent draft, remains a history entry for returning to Chat. Each main page can open the drawer. The entire foreground page slides aside with rounded corners and a subtle shadow while a strip remains visible. Tap that strip, swipe left, select a destination/conversation or use system Back to close the drawer. Back from Knowledge, Memory or Settings returns to Chat. Switching pages preserves the conversation draft and saved reading state. There is no bottom navigation bar; the composer respects keyboard and system navigation insets.

The model control in the composer opens the conversation's model picker. Select DeepSeek or Qwen for the next normal message; server-provided unavailable options stay visible with **Not configured**. Selection waits until restoration, admission, uploads, review and active external work finish. A new conversation saves its choice with its draft locally until the first admission. Existing conversations save through the server and restore from canonical snapshots. Metadata refreshes and attachment-created placeholder threads preserve newer local choices. If a model-change response is lost, sending waits for a fresh snapshot to confirm the choice. Pending requests retry the exact original input and model; review resumes inherit the interrupted run's model. Changing models keeps the full transcript and draft. **Context details** remains available in the picker and hides usage from a different model. Older servers with model-name-only metadata retain the existing context display.

Opening or switching conversations starts at their newest content. Streaming follows the latest reply while the reader remains at the bottom; scrolling upward pauses following and exposes a jump control. Physical send shortcuts preserve IME composition and Shift/Alt newline entry.

Motion is defined in `core/design/src/main/kotlin/com/agentplayground/design/Motion.kt`: short feedback fades, disclosure expansion with rotating chevrons, coordinated page transitions and interpolation between reported progress values. All Compose animations inherit Android's system duration scale, including disabled animations. Drawer selection installs the target page before the foreground settles; activity and the phone source reader support directional navigation and predictive Back previews. Attachments and input height animate without replacing the text field, changing its selection or requesting focus. Stable list keys animate localized insertions, removals and placement changes; live activity events have no entrance fades. Streaming Markdown and A2UI bindings do not replay content animations. Theme changes interpolate the existing palette while preserving the composition. Animation completion never controls server execution, admission or persistence.

Agent activity is a secondary full-screen page with native Back navigation. Chat observation continues while it is open, and returning preserves the reading position and draft. It shows event time/run groups, merged or individual streaming events, full SDK payloads and copy/clear controls. A rolling window retains up to 300 events and reports both received and retained counts; clearing affects the client log. Past events are not restored from server snapshots.

Knowledge groups upload guidance and document status, with save/reindex/delete in each document's actions menu. Memory lists shared preferences and project facts with their update date; correction, source conversation navigation and forgetting use each entry's actions menu. Correcting text retains its scope and source; forgetting requires confirmation. Both operations submit the displayed revision. Conflicts preserve the correction draft and require reviewing the latest saved version before retrying. If that version is unavailable, refresh inside the dialog. Memory remains enabled automatically in normal chat. Settings groups connection, appearance, keyboard and conversation data. Workflow results and review actions share the same card styles. The chat body shows the current workflow result; earlier cards remain under **Previous workflow steps** inside the original tool's collapsed execution details, matching the web client. Layouts remain scrollable with larger system text and constrain reading width on wide screens.

## Architecture

The Android client has nine Gradle modules:

```text
app                   Android entry points, Hilt assembly, Navigation 3 and lifecycle
core/domain           Pure JVM contracts, repository interfaces, session/recovery and projection
core/data             Retrofit REST, OkHttp SSE, repository implementations, DataStore and files
core/design           Domain-independent Compose theme, components, motion and brand resources
core/ui               Permissions, saved UI adapters and Coil image decoding
feature/conversation  Conversation Route/Screen/ViewModel/UiState and official A2UI rendering
feature/knowledge     Document Route/Screen/ViewModel/UiState and foreground observation
feature/memory        Memory Route/Screen/ViewModel/UiState and revision-conflict review
feature/settings      Settings Route/Screen/ViewModel/State and permission/connection coordination
build-logic           Shared Gradle conventions (included build)
```

Features depend on domain interfaces, design and UI. Hilt provides ViewModels and repository ports; the server-scoped graph retains conversation, knowledge and memory across Activity recreation. Navigation 3 owns primary stacks, activity back navigation and entry saved state. Routes bind lifecycle state and system launchers; Screens receive state and callbacks. Repository owners close their clients when released. `ConversationSession` keeps sole ownership of conversation run state. Coil decoders belong to the visible UI. Retrofit handles REST conversion/cancellation; OkHttp's EventSource handles SSE. DataStore retains the existing local schema.

See the [Android architecture guide](../docs/android-architecture.md) for package entry points, the dependency graph, resource lifetimes, admission/recovery guarantees and verification ownership. Storage keys, server contracts, original admission identities and user behavior are preserved by the module structure.

## Verification

- `spotlessApply` / `spotlessCheck`: format or check all Kotlin source/tests and Gradle Kotlin scripts with pinned Spotless + ktfmt, using four-space Kotlin language style. Generated build files are outside the formatter targets. `.editorconfig` uses matching Kotlin indentation.
- `lintCheck`: Android Lint analyzes every Android module and the JVM core, including test sources. Warnings and errors fail the build; HTML/XML/SARIF reports are written under each module's `build/reports/`. Only dependency upgrade advisories (`GradleDependency`, `NewerVersionAvailable` and `AndroidGradlePluginVersion`) are disabled: pinned dependency upgrades are reviewed separately, so a new remote release cannot change the quality gate.
- `architectureCheck`: enforce production module edges, feature/data boundaries and pure JVM domain ownership.
- `:core:domain:test`: protocol inputs, public reasoning compatibility, individual edited/expired reviews, output ordering/gap gates, prepared recovery, selected-model admission/retry/review inheritance, concurrent model/draft persistence, stale model snapshots, stream settlement, visibility, stale checkpoints, history coordination and attachment presentation contracts.
- `:feature:conversation:testDebugUnitTest`, `:feature:knowledge:testDebugUnitTest`, `:feature:settings:testDebugUnitTest`, `:core:data:testDebugUnitTest`, `:core:ui:testDebugUnitTest` and `:app:testDebugUnitTest`: Robolectric native Compose rendering of the official v0.9 workflow catalog, editable review UI, configuration recreation, save-target serialization, original-ID upload retry/resume and validation, initial/cross-thread scrolling, history mutation guards, Markdown/source controls, image gallery selection and gestures, bounded zoom/pan, loading cancellation, interruptible disclosure motion, zero-duration behavior, reported progress interpolation, snapshot-aware message entrances, drawer handoff, activity navigation preserving live observation/reading state, model picker availability/blocking and draft/focus preservation, canonical selection across metadata refresh and server conflicts, and a complete conversation screen through real HTTP/SSE fixtures.
- `:feature:memory:testDebugUnitTest`: pagination, revision conflicts, committed mutations after refresh errors and native correction/forget dialogs.
- `:app:assembleDebug`: installable debug build.
- `:app:assembleRelease`: optimized R8/resource-shrunk build; unsigned until a release signing configuration is supplied.

`./gradlew qualityCheck` runs all checks above, including architecture rules and both builds. From the repository root, use `make android-format`, `make android-format-check`, `make android-lint` or `make android-check`. Android checks require JDK 21 and the Android SDK; the existing Python/TypeScript `make check` remains independent.

The Android job in `.github/workflows/ci.yml` runs on pull requests and pushes to `main`. It sets up Temurin 21, SDK platform 37.1 and Build Tools 36.0.0, validates the Gradle wrapper through `setup-gradle`, and executes `qualityCheck`. Gradle task-output caching is enabled locally and in CI. GitHub Actions restores Gradle dependencies and cached build outputs from the latest compatible commit, falls back to earlier dependency state when build configuration changes, and saves updated state after a successful job. Test and lint reports are retained as a CI artifact for 14 days, including when verification fails. CI uses JVM/Robolectric tests without an emulator or a live backend.

These checks use controlled responses and do not prove live-model behavior. Device navigation, keyboard, system picker/save and background behavior should also be exercised on an emulator or physical device connected to the development stack.
