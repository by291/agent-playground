plugins { `kotlin-dsl` }

kotlin { jvmToolchain(21) }

dependencies {
    implementation("com.android.tools.build:gradle:${libs.versions.agp.get()}")
    implementation("org.jetbrains.kotlin:kotlin-gradle-plugin:${libs.versions.kotlin.get()}")
    implementation(
        "com.google.devtools.ksp:symbol-processing-gradle-plugin:${libs.versions.ksp.get()}"
    )
    implementation("com.google.dagger:hilt-android-gradle-plugin:${libs.versions.hilt.get()}")
}

gradlePlugin {
    plugins {
        register("androidLibrary") {
            id = "playground.android.library"
            implementationClass = "AndroidLibraryConventionPlugin"
        }
        register("androidApplication") {
            id = "playground.android.application"
            implementationClass = "AndroidApplicationConventionPlugin"
        }
        register("androidCompose") {
            id = "playground.android.compose"
            implementationClass = "AndroidComposeConventionPlugin"
        }
        register("androidHilt") {
            id = "playground.android.hilt"
            implementationClass = "AndroidHiltConventionPlugin"
        }
        register("kotlinLibrary") {
            id = "playground.kotlin.library"
            implementationClass = "KotlinLibraryConventionPlugin"
        }
    }
}
