# Android client conventions

- Keep the existing server as the owner of agent execution, context, persistence and external-task continuation.
- `core/` is JVM-only: application contracts, official AG-UI types, HTTP/SSE, submission/recovery and output ordering.
- `app/` owns Android lifecycle, DataStore, ContentResolver, Material 3 and feature UI. ViewModels orchestrate repositories; Composables render state and dispatch actions.
- Keep A2UI library details inside `features/workflow/`. Use the official renderer and protocol types; custom components must match the existing workflow catalog.
- Maintain explicit resource ownership. Release jobs and API clients when their owner is disposed; preserve original admission identities before network requests.
- Store settings and journals by normalized server URL. Never copy backend model/storage credentials into the app.
- Use Kotlin language style (four-space indentation), braces and separate statements. Keep validation, preparation, persistence/network and UI state stages visibly grouped.
- Verify with `./gradlew :core:test :app:testDebugUnitTest :app:lintDebug :app:assembleDebug` from this directory. Live device/model validation is separate.
- Keep this guide and README current when compatibility requirements or public behavior changes.
