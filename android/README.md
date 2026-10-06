# Agent Playground for Android

A native Jetpack Compose client for the existing Agent Playground server. It runs the same conversations, Skills, SQL/experiment/report workflows and shared knowledge operations as the web client.

## Build and run

Open this directory as a project in Android Studio. Use JDK 21, Android SDK **37.1**, and the checked-in Gradle wrapper. Runtime support starts at Android 8.0 / API 26. The current AndroidX A2UI alpha renderer requires SDK 37.1 and pulls Compose 1.13 alpha runtime/UI dependencies; it is isolated in `features/workflow/`.

```sh
cd android
# Set JAVA_HOME to your JDK 21 installation.
# Set ANDROID_HOME, or create an untracked local.properties with sdk.dir.
./gradlew qualityCheck
```

The debug APK is `app/build/outputs/apk/debug/app-debug.apk`. The wrapper uses Gradle 9.5.0 with AGP 9.3.3.

Start the existing backend with `make dev` from the repository root. In the app's **Settings**, connect to the TypeScript server:

- Android emulator: `http://10.0.2.2:3000/` (default).
- Physical device: `http://<computer-LAN-address>:3000/`, with both devices on the same network.
- USB development: `adb reverse tcp:3000 tcp:3000`, then connect to `http://127.0.0.1:3000/`.

Connect to port **3000**, not Vite or Aegra. Connection checks `/health` and `/agent-info`. Debug builds allow HTTP for local development; release builds require HTTPS. Model and storage credentials remain on the backend. This client follows the server's current shared-workspace model without adding an authentication protocol.

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
| Files                | System document picker; four attachments per message, 10 MiB each; system save dialog for outputs/originals.                                                                         |
| Knowledge            | Validated TXT/Markdown/text PDFs; original-ID upload retry/resume after restart; status/chunks/errors, reindex, confirmed delete and save original.                                  |
| Sources              | Reply-scoped documents/excerpts and exact citation links; native reader with passage navigation, PDF page and original-document download.                                            |
| Preferences          | Light/dark/system theme, reply animation and hardware keyboard send shortcut.                                                                                                        |

The web-only Monaco/A2UI development gallery and browser telemetry bootstrap are not Android screens. There is no client-side agent execution, offline execution, background Android worker or cancellation endpoint. Leaving the app does not cancel the server run. Streaming observation recovers from snapshots rather than a durable event replay log. Reply animation uses native scrolling rather than reproducing the browser's text-draining animation.

## Interface

The client uses white and graphite surfaces, restrained blue accents, scalable typography and matching light/dark themes. Chat has a compact header, an integrated composer and expandable reasoning, tools and sources. Starter prompts populate the draft for editing before sending. History uses a drawer on phones and a persistent sidebar on wide screens; the system Back action closes the drawer first. Opening or switching conversations starts at their newest content. Streaming follows the latest reply while the reader remains at the bottom; scrolling upward pauses following and exposes a jump control. The bottom navigation is hidden while the software keyboard is open. Physical send shortcuts preserve IME composition and Shift/Alt newline entry.

Agent activity is a secondary full-screen page with native Back navigation. Chat observation continues while it is open, and returning preserves the reading position and draft. It shows event time/run groups, merged or individual streaming events, full SDK payloads and copy/clear controls. A rolling window retains up to 300 events and reports both received and retained counts; clearing affects the client log. Past events are not restored from server snapshots.

Knowledge groups upload guidance and document status, with save/reindex/delete in each document's actions menu. Settings groups connection, appearance, keyboard and conversation data. Workflow results and review actions share the same card styles. Layouts remain scrollable with larger system text and constrain reading width on wide screens.

## Architecture

```text
app (Android)
  MainActivity / application composition and resource ownership
  data/        DataStore preferences and per-server conversation journal
  files/       ContentResolver document access and bounded reads
  design/      Material 3 theme and shared UI
  features/
    conversation/  ViewModel, history, timeline, composer, messages/reviews
    knowledge/     ViewModel, document operations and status polling
    settings/      Connection and user preferences
    workflow/      AndroidX A2UI catalog and composition-owned renderer
        ↓
core (JVM)
  Contracts.kt            Application REST/persistence contracts
  PlaygroundApi.kt        OkHttp REST and library SSE transport
  ConversationSession.kt  Run lifecycle and StateFlow, independent of Android UI
  Submission.kt           Admission input, review response and file validation
  Recovery.kt             Pending identity and checkpoint reconciliation
  OutputBuffer.kt         Sequenced envelope deduplication/gap detection
        ↓
Existing TypeScript HTTP/AG-UI server → Aegra → Python agent
```

Activity-retained ViewModels own API clients and session jobs, preserving attachments and transfers through configuration recreation. Pending save targets use saved state. Server changes dispose the previous ViewModel graph. Conversation observation is attached while chat or activity is started; knowledge polls only while visible and indexing is pending. Renderer actors run in composition-owned coroutines. The core module uses official AG-UI protocol types; application REST types correspond to `shared/` and the web snapshot contract.

Each thread's draft/pending input is stored separately under its normalized server URL. A request is saved before POST, including the original run and message IDs. An unobserved admission or server `prepared` admission is retried with exactly the saved payload; dispatched/running/unknown submissions are watched until a canonical checkpoint confirms them. Local streaming messages are protected from snapshots fetched before newer stream events and from older unfinished checkpoints. Admission remains locked through persistence and stream settlement. Plan drafts and decisions are session-owned; edits invalidate a prior decision and all plans are revalidated before batching. Workflow output envelopes are applied in contiguous sequence order, detect conflicting duplicates and wait for missing predecessors. The official A2UI processor handles protocol validation, component registry and dynamic binding.

Files use the Storage Access Framework without broad storage permissions. Attachment selections and unfinished knowledge-upload queues survive screen rotation but are not persisted across process death. After restarting, a server document still marked uploading exposes Resume upload: reselect the original name/size/type to transfer under its original document ID. Unknown-length streams are bounded during reads. Failed uploads retain the draft and selected attachments, and retries reuse file IDs. Knowledge upload retries retain their original document IDs and provide explicit retry/discard controls. Knowledge documents and generated files remain backend resources; native downloads copy into the user-selected destination.

## Verification

- `spotlessApply` / `spotlessCheck`: format or check all Kotlin source/tests and Gradle Kotlin scripts with pinned Spotless + ktfmt, using four-space Kotlin language style. Generated build files are outside the formatter targets. `.editorconfig` uses matching Kotlin indentation.
- `:core:lint` / `:app:lintDebug`: Android Lint analyzes the JVM core and Android app, including test sources. Warnings and errors fail the build; HTML/XML/SARIF reports are written under each module's `build/reports/`. Only dependency upgrade advisories (`GradleDependency` and `NewerVersionAvailable`) are disabled: pinned dependency upgrades are reviewed separately, so a new remote release cannot change the quality gate.
- `:core:test`: protocol inputs, public reasoning compatibility, individual edited/expired reviews, output ordering/gap gates, prepared recovery, concurrent admission/draft persistence, stream settlement, visibility, stale checkpoints, real HTTP/SSE fixtures and file boundaries.
- `:app:testDebugUnitTest`: Robolectric native Compose rendering of the official v0.9 workflow catalog, editable review UI, configuration recreation, save-target serialization, original-ID upload retry/resume and validation, initial/cross-thread scrolling, history mutation guards, Markdown/source controls, activity navigation preserving live observation/reading state, and a complete conversation screen through real HTTP/SSE fixtures.
- `:app:assembleDebug`: installable debug build.
- `:app:assembleRelease`: optimized R8/resource-shrunk build; unsigned until a release signing configuration is supplied.

`./gradlew qualityCheck` runs all checks above, including both builds. From the repository root, use `make android-format`, `make android-format-check`, `make android-lint` or `make android-check`. Android checks require JDK 21 and the Android SDK; the existing Python/TypeScript `make check` remains independent.

The Android job in `.github/workflows/ci.yml` runs on pull requests and pushes to `main`. It sets up Temurin 21, SDK platform 37.1 and Build Tools 36.0.0, validates the Gradle wrapper through `setup-gradle`, caches Gradle dependencies and executes `qualityCheck`. Test and lint reports are retained as a CI artifact for 14 days, including when verification fails. CI uses JVM/Robolectric tests without an emulator or a live backend.

These checks use controlled responses and do not prove live-model behavior. Device navigation, keyboard, system picker/save and background behavior should also be exercised on an emulator or physical device connected to the development stack.
