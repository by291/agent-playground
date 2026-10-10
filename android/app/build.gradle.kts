plugins {
    alias(libs.plugins.kotlin.serialization)
    id("playground.android.application")
    id("playground.android.hilt")
}

android {
    namespace = "com.agentplayground.app"
    defaultConfig {
        applicationId = "com.agentplayground.android"
        versionCode = 1
        versionName = "0.1.0"
    }
    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
        }
    }
}

dependencies {
    implementation(libs.navigation.runtime)
    implementation(libs.navigation.ui)
    implementation(libs.lifecycle.navigation)
    implementation(libs.serialization)
    implementation(project(":core:domain"))
    implementation(project(":core:data"))
    implementation(project(":core:design"))
    implementation(project(":core:ui"))
    implementation(libs.hilt.compose)
    implementation(libs.coroutines)
    implementation(project(":feature:conversation"))
    implementation(project(":feature:knowledge"))
    implementation(project(":feature:memory"))
    implementation(project(":feature:settings"))
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.material3)
    implementation(libs.activity.compose)
    implementation(libs.lifecycle.compose)
    implementation(libs.lifecycle.viewmodel)
    implementation(libs.coroutines.android)

    debugImplementation(libs.compose.tooling)
    debugImplementation(libs.compose.ui.test.manifest)

    testImplementation(libs.compose.ui.test)
    testImplementation(libs.mockwebserver)
    testImplementation(libs.junit)
    testImplementation(libs.robolectric)
}
