plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "com.agentplayground.feature.knowledge"
    buildFeatures { compose = true }
}

dependencies {
    implementation(project(":data"))
    implementation(project(":ui"))
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.material3)
    implementation(libs.compose.icons)
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
