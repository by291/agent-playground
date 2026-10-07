# Agent Playground for Android

A native Jetpack Compose client for the existing Agent Playground server. It runs the same conversations, Skills, SQL/experiment/report workflows, A2A collaborations and shared knowledge operations as the web client.

## Build and run

Open this directory as a project in Android Studio. Use JDK 21, Android SDK **37.1**, and the checked-in Gradle wrapper. Runtime support starts at Android 8.0 / API 26. The current AndroidX A2UI alpha renderer requires SDK 37.1 and pulls Compose 1.13 alpha runtime/UI dependencies; it is isolated in `feature/conversation/` under `ui/workflow/`.

```sh
cd android
# Set JAVA_HOME to your JDK 21 installation.
# Set ANDROID_HOME, or create an untracked local.properties with sdk.dir.
./gradlew qualityCheck
```

In PowerShell, run `.\gradlew.bat qualityCheck` instead. The repository-root `make android-*` commands select the native wrapper automatically.

The debug APK is `app/build/outputs/apk/debug/app-debug.apk`. The wrapper uses Gradle 9.5.0 with AGP 9.3.3.

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
| Recovery             | Server snapshots after streams and on reconnect; a per-server/thread journal retains pending admissions.                                                                             |
| Reasoning and tools  | Phase-aware reasoning, paired tool arguments/results and execution status, grouped Skills and output downloads; separate live activity page.                                         |
| Workflows            | Official Compose A2UI runtime with WorkflowPanel, WorkflowText, WorkflowSteps and WorkflowSql; earlier presentations remain expandable.                                              |
| Human review         | Editable plans with immediate single decisions and explicit final confirmation for multiple plans; workflow accept/abandon and conversational feedback with revision/round identity. |
| Reports              | External task status, progress, errors and history; server-owned continuation survives client absence.                                                                               |
| A2A collaboration    | Three-step draft/review/revision handoffs, live child Markdown, expandable intermediate results, clarification input and confirmed cancellation.                                     |
| Files                | System document picker; four attachments per message, 10 MiB each; system save dialog for outputs/originals.                                                                         |
| Knowledge            | Validated TXT/Markdown/text PDFs; original-ID upload retry/resume after restart; status/chunks/errors, reindex, confirmed delete and save original.                                  |
| Sources              | Reply-scoped numbered citations; a partial bottom sheet expands to full height, with exact passage navigation, PDF page and original-document download.                              |
| Preferences          | Light/dark/system theme, reply animation and hardware keyboard send shortcut.                                                                                                        |

The web-only Monaco/A2UI development gallery and browser telemetry bootstrap are not Android screens. There is no client-side agent execution, offline execution or background Android worker. A2A tasks expose the existing server's input/cancel controls; ordinary conversation runs have no cancellation control. Leaving the app does not cancel the server run. Streaming observation recovers from snapshots rather than a durable event replay log. Reply animation controls one-time entrances for new messages/review/task cards and smooth jumping to the latest message. Streaming text updates and restored history remain immediate; the client does not reproduce the browser's text-draining animation.

## Interface

The client uses white and graphite surfaces, restrained blue accents, scalable typography and matching light/dark themes. Launcher, monochrome and drawer branding reuse the project's stack mark. User messages have a stronger neutral bubble with a compact trailing corner. Chat has a compact header and an integrated composer. Reasoning uses a lightweight disclosure row with a left rail for expanded notes. It preserves manual folding and collapses only after visible answer content arrives. Ordinary tools in the same reply share one collapsed summary; Skills are grouped separately by name. Tool and Skill rows show a category, name and execution status; each call has its own disclosure for parameters and results. Group and call expansion survive appended calls, and failures remain visible with the group collapsed. Payloads preserve selectable content; large values scroll within their detail pane.

Markdown replies use consistent heading and paragraph spacing, themed quotes, compact monospace inline code that wraps with the surrounding prose, syntax-highlighted code panels with language/copy headers, and horizontally scrollable tables with selectable rich-text cells. Inline code uses the theme's secondary text color without a filled background or added spacing. Long code-block lines scroll horizontally; copying preserves the original code or tab-separated table data and remains disabled during streaming. Starter prompts populate the draft for editing before sending.

A2A task panels show the draft, review and revision handoffs with their purpose and status. The Coordinator dispatches each handoff through independent Planner and Reviewer services. Active child output expands as accumulated Markdown snapshots arrive; completed intermediate steps collapse, final revisions stay open, and failed/cancelled tasks retain their latest partial output. Manual expansion survives progress updates. Matching old numbered result cards are omitted from the conversation display once the completed revision is available, while stored outputs and presentation ownership are preserved.

When an agent requests clarification, enter **Additional information** and tap **Continue agents**. **Cancel agents** requests server cancellation; neither control optimistically changes the task status. Controls share a pending guard and show local errors for retry. The session owns requests and cancels them when switching conversations or disposing the ViewModel. SSE change notifications and foreground recovery polling refresh child snapshots, including clarification waits; stale revisions cannot replace newer output or terminal continuation state.

After the child stages finish, the server resumes the parent workflow to publish its receipt and final reply. This normal background continuation shows **Agent is completing the workflow…**, even without a direct client output stream. Other healthy observed runs show **Agent is working…**; recovery feedback is reserved for reported errors, missing outputs or an uncertain submission.

The history drawer on phones and the persistent sidebar on wide screens follow the web workspace hierarchy: New conversation and Knowledge above conversations, with the configured server and a Settings control in the footer. The current conversation, including an unsent draft, remains a history entry for returning to Chat. Each main page can open the drawer. The entire foreground page slides aside with rounded corners and a subtle shadow while a strip remains visible. Tap that strip, swipe left, select a destination/conversation or use system Back to close the drawer. Back from Knowledge or Settings returns to Chat. Switching pages preserves the conversation draft and saved reading state. There is no bottom navigation bar; the composer respects keyboard and system navigation insets.

Opening or switching conversations starts at their newest content. Streaming follows the latest reply while the reader remains at the bottom; scrolling upward pauses following and exposes a jump control. Physical send shortcuts preserve IME composition and Shift/Alt newline entry.

Motion is defined in `ui/src/main/kotlin/com/agentplayground/ui/Motion.kt`: short feedback fades, disclosure expansion with rotating chevrons, coordinated page transitions and interpolation between reported progress values. All Compose animations inherit Android's system duration scale, including disabled animations. Drawer selection installs the target page before the foreground settles; activity and the phone source reader support directional navigation and predictive Back previews. Attachments and input height animate without replacing the text field, changing its selection or requesting focus. Stable list keys animate localized insertions, removals and placement changes; live activity events have no entrance fades. Streaming Markdown and A2UI bindings do not replay content animations. Theme changes interpolate the existing palette while preserving the composition. Animation completion never controls server execution, admission or persistence.

Agent activity is a secondary full-screen page with native Back navigation. Chat observation continues while it is open, and returning preserves the reading position and draft. It shows event time/run groups, merged or individual streaming events, full SDK payloads and copy/clear controls. A rolling window retains up to 300 events and reports both received and retained counts; clearing affects the client log. Past events are not restored from server snapshots.

Knowledge groups upload guidance and document status, with save/reindex/delete in each document's actions menu. Settings groups connection, appearance, keyboard and conversation data. Workflow results and review actions share the same card styles. The chat body shows the current workflow result; earlier cards remain under **Previous workflow steps** inside the original tool's collapsed execution details, matching the web client. Layouts remain scrollable with larger system text and constrain reading width on wide screens.

## Architecture

The Android client has seven Gradle modules:

```text
app                   Entry points, dependency assembly, navigation and lifecycle
feature/conversation  Conversation UI/state and official A2UI workflow rendering
feature/knowledge     Knowledge UI/state and foreground status observation
feature/settings      Settings UI/state and permission/connection coordination
data                  Repositories, preferences/journals and platform file/image access
ui                    Shared Compose design, brand resources and permission bridges
core                  JVM models, HTTP/SSE, conversation runtime and pure presentation
```

Features depend on data and shared UI; app assembles them. ViewModels coordinate screen state and repositories. Routes collect state with AndroidX lifecycle APIs and retain system permission/file-picker interactions at the UI boundary. Rendering components receive data and action callbacks. Repositories own transport and platform data access; `ConversationSession` retains sole ownership of conversation run state. Each repository is closed by its owning ViewModel when the server-scoped graph is released.

See the [Android architecture guide](../docs/android-architecture.md) for package entry points, the dependency graph, resource lifetimes, admission/recovery guarantees and verification ownership. Storage keys, server contracts, original admission identities and user behavior are preserved by the module structure.

## Verification

- `spotlessApply` / `spotlessCheck`: format or check all Kotlin source/tests and Gradle Kotlin scripts with pinned Spotless + ktfmt, using four-space Kotlin language style. Generated build files are outside the formatter targets. `.editorconfig` uses matching Kotlin indentation.
- `lintCheck`: Android Lint analyzes every Android module and the JVM core, including test sources. Warnings and errors fail the build; HTML/XML/SARIF reports are written under each module's `build/reports/`. Only dependency upgrade advisories (`GradleDependency`, `NewerVersionAvailable` and `AndroidGradlePluginVersion`) are disabled: pinned dependency upgrades are reviewed separately, so a new remote release cannot change the quality gate.
- `:core:test`: protocol inputs, public reasoning compatibility, individual edited/expired reviews, output ordering/gap gates, prepared recovery, concurrent admission/draft persistence, stream settlement, visibility, stale checkpoints, real HTTP/SSE fixtures and file boundaries.
- `:feature:conversation:testDebugUnitTest`, `:feature:knowledge:testDebugUnitTest`, `:feature:settings:testDebugUnitTest`, `:data:testDebugUnitTest`, `:ui:testDebugUnitTest` and `:app:testDebugUnitTest`: Robolectric native Compose rendering of the official v0.9 workflow catalog, editable review UI, configuration recreation, save-target serialization, original-ID upload retry/resume and validation, initial/cross-thread scrolling, history mutation guards, Markdown/source controls, image gallery selection and gestures, bounded zoom/pan, loading cancellation, interruptible disclosure motion, zero-duration behavior, reported progress interpolation, snapshot-aware message entrances, drawer handoff, activity navigation preserving live observation/reading state, and a complete conversation screen through real HTTP/SSE fixtures.
- `:app:assembleDebug`: installable debug build.
- `:app:assembleRelease`: optimized R8/resource-shrunk build; unsigned until a release signing configuration is supplied.

`./gradlew qualityCheck` runs all checks above, including both builds. From the repository root, use `make android-format`, `make android-format-check`, `make android-lint` or `make android-check`. Android checks require JDK 21 and the Android SDK; the existing Python/TypeScript `make check` remains independent.

The Android job in `.github/workflows/ci.yml` runs on pull requests and pushes to `main`. It sets up Temurin 21, SDK platform 37.1 and Build Tools 36.0.0, validates the Gradle wrapper through `setup-gradle`, and executes `qualityCheck`. Gradle task-output caching is enabled locally and in CI. GitHub Actions restores Gradle dependencies and cached build outputs from the latest compatible commit, falls back to earlier dependency state when build configuration changes, and saves updated state after a successful job. Test and lint reports are retained as a CI artifact for 14 days, including when verification fails. CI uses JVM/Robolectric tests without an emulator or a live backend.

These checks use controlled responses and do not prove live-model behavior. Device navigation, keyboard, system picker/save and background behavior should also be exercised on an emulator or physical device connected to the development stack.
