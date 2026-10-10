plugins {
    id("playground.android.library")
    id("playground.android.hilt")
    alias(libs.plugins.kotlin.serialization)
}

android { namespace = "com.agentplayground.data" }

dependencies {
    implementation(project(":core:domain"))
    implementation(libs.datastore)
    implementation(libs.coroutines.android)
    implementation(libs.retrofit.core)
    implementation(libs.retrofit.serialization)
    implementation(libs.okhttp)
    implementation(libs.okhttp.sse)
    implementation(libs.androidx.core)
    testImplementation(libs.junit)
    testImplementation(libs.coroutines.test)
    testImplementation(libs.mockwebserver)
    testImplementation(libs.robolectric)
}
