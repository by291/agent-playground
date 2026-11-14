import com.android.build.api.dsl.LibraryExtension
import org.gradle.api.JavaVersion
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.api.artifacts.VersionCatalogsExtension
import org.gradle.kotlin.dsl.configure
import org.gradle.kotlin.dsl.getByType

class AndroidLibraryConventionPlugin : Plugin<Project> {
    override fun apply(target: Project): Unit =
        with(target) {
            pluginManager.apply("com.android.library")

            val catalog = extensions.getByType<VersionCatalogsExtension>().named("libs")
            val lifecycleRuntime = catalog.findLibrary("lifecycle-runtime").get().get()

            dependencies.constraints.add("implementation", lifecycleRuntime) {
                because("AGP 9.5 Lint requires Lifecycle 2.10.0 or newer for bundled checks")
            }

            extensions.configure<LibraryExtension> {
                compileSdk = 37
                compileSdkMinor = 1
                defaultConfig { minSdk = 26 }
                compileOptions {
                    sourceCompatibility = JavaVersion.VERSION_17
                    targetCompatibility = JavaVersion.VERSION_17
                }

                testOptions { unitTests.isIncludeAndroidResources = true }
                lint { configurePlaygroundLint() }
            }
        }
}
