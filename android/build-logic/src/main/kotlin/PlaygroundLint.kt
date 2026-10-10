import com.android.build.api.dsl.Lint

internal fun Lint.configurePlaygroundLint() {
    abortOnError = true
    warningsAsErrors = true
    checkTestSources = true
    // Dependency upgrades are reviewed separately from code correctness.
    disable += setOf("GradleDependency", "NewerVersionAvailable", "AndroidGradlePluginVersion")
}
