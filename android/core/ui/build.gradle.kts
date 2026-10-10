plugins { id("playground.android.compose") }

android { namespace = "com.agentplayground.ui" }

dependencies {
    implementation(project(":core:domain"))
    implementation(project(":core:design"))
    implementation(libs.activity.compose)
    implementation(libs.coil.core)
    implementation(libs.coroutines.android)
    implementation(libs.androidx.core)
    testImplementation(libs.junit)
    testImplementation(libs.robolectric)
}
