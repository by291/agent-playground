plugins { id("playground.android.compose") }

android { namespace = "com.agentplayground.design" }

dependencies {
    implementation(libs.activity.compose)
    implementation(libs.highlights)
}
