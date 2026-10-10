plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.library) apply false
    alias(libs.plugins.android.lint) apply false
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.ksp) apply false
    alias(libs.plugins.hilt) apply false
    alias(libs.plugins.spotless)
}

apply(from = "architecture.gradle.kts")

val androidLibraries =
    listOf(
        ":core:data",
        ":core:design",
        ":core:ui",
        ":feature:conversation",
        ":feature:knowledge",
        ":feature:memory",
        ":feature:settings",
    )

spotless {
    kotlin {
        target("**/src/**/*.kt")
        targetExclude("**/build/**", ".gradle/**")
        ktfmt(libs.versions.ktfmt.get()).kotlinlangStyle()
    }
    kotlinGradle {
        target("**/*.gradle.kts")
        targetExclude("**/build/**", ".gradle/**")
        ktfmt(libs.versions.ktfmt.get()).kotlinlangStyle()
    }
}

tasks.register("lintCheck") {
    group = "verification"
    description = "Checks lint in every Android and JVM module, including tests."
    dependsOn(":core:domain:lint", ":app:lintDebug")
    dependsOn(androidLibraries.map { "$it:lintDebug" })
}

tasks.register("qualityCheck") {
    group = "verification"
    description = "Checks architecture, formatting, lint, tests and debug/release builds."
    dependsOn(
        "architectureCheck",
        "spotlessCheck",
        "lintCheck",
        ":core:domain:test",
        ":app:testDebugUnitTest",
        ":app:assembleDebug",
        ":app:assembleRelease",
    )
    dependsOn(androidLibraries.map { "$it:testDebugUnitTest" })
}
