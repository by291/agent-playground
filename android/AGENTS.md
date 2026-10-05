# Android client conventions

- Keep the existing server as the owner of agent execution, context, persistence and external-task continuation.
- `core/` is JVM-only: application contracts, official AG-UI types, HTTP/SSE, submission/recovery and output ordering.
- `app/` owns Android lifecycle, DataStore, ContentResolver, Material 3 and feature UI. ViewModels orchestrate repositories; Composables render state and dispatch actions.
- Keep A2UI library details inside `features/workflow/`. Use the official renderer and protocol types; custom components must match the existing workflow catalog.
- Maintain explicit resource ownership. Release jobs and API clients when their owner is disposed; preserve original admission identities before network requests.
- Store settings and journals by normalized server URL. Never copy backend model/storage credentials into the app.
- Use Kotlin language style (four-space indentation), braces and separate statements. Keep validation, preparation, persistence/network and UI state stages visibly grouped.
- Format Kotlin source/tests and Gradle Kotlin scripts with `./gradlew spotlessApply`. Spotless pins ktfmt with Kotlin language style; `spotlessCheck` verifies without editing files.
- Android Lint covers both the Android app and the JVM core, including tests. Warnings fail the check; fix findings rather than adding a blanket baseline. Dependency upgrade advisories (`GradleDependency` and `NewerVersionAvailable`) are disabled because versions are pinned and upgrades are reviewed separately.
- Verify with `./gradlew qualityCheck` from this directory. It checks formatting, lint, JVM/Robolectric tests and debug/unsigned release builds; GitHub CI runs the same task. Live device/model validation is separate.
- Keep this guide and README current when compatibility requirements or public behavior changes.
