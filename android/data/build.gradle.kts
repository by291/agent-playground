plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.serialization)
}

android { namespace = "com.agentplayground.data" }

dependencies {
    api(project(":core"))
    implementation(libs.datastore)
    implementation(libs.coroutines.android)
    implementation(libs.coil.core)
    implementation(libs.androidx.core)

    testImplementation(libs.junit)
    testImplementation(libs.robolectric)
}
