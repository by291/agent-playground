plugins { id("playground.kotlin.library") }

dependencies {
    api(libs.agui)
    api(libs.serialization)
    api(libs.coroutines)
    testImplementation(libs.junit)
    testImplementation(libs.coroutines.test)
}
