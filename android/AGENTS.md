# Android client conventions

- Keep the existing server as the owner of agent execution, context, persistence and external-task continuation.
- `core/` is JVM-only: application contracts, official AG-UI types, HTTP/SSE, submission/recovery and output ordering.
- `app/` owns Android lifecycle, DataStore, ContentResolver, Material 3 and feature UI. ViewModels orchestrate repositories; Composables render state and dispatch actions.
- Keep A2UI library details inside `features/workflow/`. Use the official renderer and protocol types; custom components must match the existing workflow catalog.
- Maintain explicit resource ownership. Release jobs and API clients when their owner is disposed; preserve original admission identities before network requests.
- Store settings and journals by normalized server URL. Never copy backend model/storage credentials into the app.
- Follow the [Kotlin coding conventions](https://kotlinlang.org/docs/coding-conventions.html) and [Android Kotlin style guide](https://developer.android.com/kotlin/style-guide), with the project rules below taking precedence. Use four-space indentation and one statement per line.
- Separate functions, constructors and nested classes with one blank line. Keep related properties together, including a backing state flow and its public view; separate property groups when their responsibilities differ.
- Divide function bodies into logical stages such as validation, preparation, network/persistence, state publication and response construction. Separate these stages with one blank line. Add space around control-flow blocks and before a final return when it marks a new stage; keep short, closely related statements together rather than adding a blank line after every statement.
- In Composables, separate state/derived values, lifecycle effects and UI rendering. Inside callbacks, separate validation, side effects and state publication. Use blank lines between distinct page sections; keep related child widgets and constructor arguments compact.
- Use braces for control-flow statements and multiline `if`/`else` expressions. A complete conditional expression that fits on one line may omit braces. Keep simple expression-body functions concise; separate substantial `when` branches while leaving adjacent simple cases together.
- Organize tests into fixture/setup, actions and assertions with blank lines between phases. Keep assertions about the same result together and preserve the ordering of resource acquisition, actions and cleanup.
- Format Kotlin source/tests and Gradle Kotlin scripts with `./gradlew spotlessApply`. Spotless pins ktfmt with Kotlin language style; `spotlessCheck` verifies without editing files. The formatter handles indentation and wrapping, but logical grouping and readable blank lines still require manual review. These conventions apply to source and tests alike.
- Android Lint covers both the Android app and the JVM core, including tests. Warnings fail the check; fix findings rather than adding a blanket baseline. Dependency upgrade advisories (`GradleDependency` and `NewerVersionAvailable`) are disabled because versions are pinned and upgrades are reviewed separately.
- Verify with `./gradlew qualityCheck` from this directory. It checks formatting, lint, JVM/Robolectric tests and debug/unsigned release builds; GitHub CI runs the same task. Live device/model validation is separate.
- Keep this guide and README current when compatibility requirements or public behavior changes.
