plugins {
    id("playground.android.compose")
    id("playground.android.hilt")
}

android { namespace = "com.agentplayground.feature.settings" }

dependencies {
    implementation(project(":core:domain"))
    implementation(project(":core:design"))
    implementation(project(":core:ui"))
    implementation(libs.hilt.compose)
    testImplementation(project(":core:data"))
    implementation(libs.activity.compose)
    implementation(libs.lifecycle.compose)
    implementation(libs.lifecycle.viewmodel)
    implementation(libs.coroutines.android)

    debugImplementation(libs.compose.ui.test.manifest)
    testImplementation(libs.compose.ui.test)
    testImplementation(libs.mockwebserver)
    testImplementation(libs.junit)
    testImplementation(libs.robolectric)
}
