plugins {
    id("playground.android.compose")
    id("playground.android.hilt")
}

android { namespace = "com.agentplayground.feature.conversation" }

dependencies {
    implementation(project(":core:domain"))
    implementation(project(":core:design"))
    implementation(project(":core:ui"))
    testImplementation(project(":core:data"))
    implementation(libs.activity.compose)
    implementation(libs.lifecycle.compose)
    implementation(libs.lifecycle.viewmodel)
    implementation(libs.coroutines.android)
    implementation(libs.a2ui)
    implementation(libs.markdown.renderer)
    implementation(libs.markdown.material3)
    implementation(libs.commonmark.core)
    implementation(libs.commonmark.tables)
    implementation(libs.commonmark.strikethrough)
    implementation(libs.highlights)

    debugImplementation(libs.compose.ui.test.manifest)
    testImplementation(libs.compose.ui.test)
    testImplementation(libs.mockwebserver)
    testImplementation(libs.junit)
    testImplementation(libs.robolectric)
}
