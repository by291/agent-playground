plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "com.agentplayground.app"
    compileSdk = 37
    compileSdkMinor = 1

    defaultConfig {
        applicationId = "com.agentplayground.android"
        minSdk = 26
        targetSdk = 37
        versionCode = 1
        versionName = "0.1.0"
    }

    buildFeatures { compose = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
        }
    }
    testOptions { unitTests.isIncludeAndroidResources = true }

    lint {
        abortOnError = true
        warningsAsErrors = true
        checkTestSources = true
        // Dependency upgrades are reviewed separately from code correctness.
        disable += setOf("GradleDependency", "NewerVersionAvailable", "AndroidGradlePluginVersion")
    }
}

dependencies {
    implementation(project(":data"))
    implementation(project(":ui"))
    implementation(project(":feature:conversation"))
    implementation(project(":feature:knowledge"))
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
