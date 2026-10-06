plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.lint) apply false
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.spotless)
}

spotless {
    kotlin {
        target("app/src/**/*.kt", "core/src/**/*.kt")
        ktfmt(libs.versions.ktfmt.get()).kotlinlangStyle()
    }
    kotlinGradle {
        target("*.gradle.kts", "app/*.gradle.kts", "core/*.gradle.kts")
        ktfmt(libs.versions.ktfmt.get()).kotlinlangStyle()
    }
}

tasks.register("qualityCheck") {
    group = "verification"
    description = "Checks formatting, lint, tests and debug/release builds."

    dependsOn(
        "spotlessCheck",
        ":core:lint",
        ":core:test",
        ":app:lintDebug",
        ":app:testDebugUnitTest",
        ":app:assembleDebug",
        ":app:assembleRelease",
    )
}
