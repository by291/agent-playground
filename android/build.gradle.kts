plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.library) apply false
    alias(libs.plugins.android.lint) apply false
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.spotless)
}

val androidLibraries =
    listOf(":data", ":ui", ":feature:conversation", ":feature:knowledge", ":feature:settings")

subprojects {
    plugins.withId("com.android.library") {
        extensions.configure<com.android.build.api.dsl.LibraryExtension> {
            compileSdk = 37
            compileSdkMinor = 1

            defaultConfig { minSdk = 26 }

            compileOptions {
                sourceCompatibility = JavaVersion.VERSION_17
                targetCompatibility = JavaVersion.VERSION_17
            }

            testOptions { unitTests.isIncludeAndroidResources = true }

            lint {
                abortOnError = true
                warningsAsErrors = true
                checkTestSources = true
                disable +=
                    setOf("GradleDependency", "NewerVersionAvailable", "AndroidGradlePluginVersion")
            }
        }
    }
}

spotless {
    kotlin {
        target("*/src/**/*.kt", "feature/*/src/**/*.kt")
        ktfmt(libs.versions.ktfmt.get()).kotlinlangStyle()
    }
    kotlinGradle {
        target("*.gradle.kts", "*/build.gradle.kts", "feature/*/build.gradle.kts")
        ktfmt(libs.versions.ktfmt.get()).kotlinlangStyle()
    }
}

tasks.register("lintCheck") {
    group = "verification"
    description = "Checks lint in every Android and JVM module, including tests."

    dependsOn(":core:lint", ":app:lintDebug")
    dependsOn(androidLibraries.map { "$it:lintDebug" })
}

tasks.register("qualityCheck") {
    group = "verification"
    description = "Checks formatting, lint, tests and debug/release builds."

    dependsOn(
        "spotlessCheck",
        "lintCheck",
        ":core:test",
        ":app:testDebugUnitTest",
        ":app:assembleDebug",
        ":app:assembleRelease",
    )

    dependsOn(androidLibraries.map { "$it:testDebugUnitTest" })
}
