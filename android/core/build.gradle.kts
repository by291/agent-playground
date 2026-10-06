plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.android.lint)
}

lint {
    abortOnError = true
    warningsAsErrors = true
    checkTestSources = true
    sarifReport = true
    // Dependency upgrades are reviewed separately from code correctness.
    disable += setOf("GradleDependency", "NewerVersionAvailable")
}

kotlin {
    jvmToolchain(21)

    compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) }
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

dependencies {
    api(libs.agui)
    api(libs.serialization)
    api(libs.coroutines)
    implementation(libs.okhttp)
    implementation(libs.okhttp.sse)

    testImplementation(libs.junit)
    testImplementation(libs.coroutines.test)
    testImplementation(libs.mockwebserver)
}
