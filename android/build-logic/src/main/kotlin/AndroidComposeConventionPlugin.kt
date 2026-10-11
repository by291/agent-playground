import com.android.build.api.dsl.LibraryExtension
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.api.artifacts.VersionCatalogsExtension
import org.gradle.kotlin.dsl.configure
import org.gradle.kotlin.dsl.getByType

class AndroidComposeConventionPlugin : Plugin<Project> {
    override fun apply(target: Project): Unit =
        with(target) {
            pluginManager.apply("playground.android.library")
            pluginManager.apply("org.jetbrains.kotlin.plugin.compose")
            extensions.configure<LibraryExtension> { buildFeatures.compose = true }

            val catalog = extensions.getByType<VersionCatalogsExtension>().named("libs")
            dependencies.add(
                "implementation",
                dependencies.platform(catalog.findLibrary("compose-bom").get()),
            )

            for (library in listOf("compose-ui", "compose-material3", "compose-icons")) {
                dependencies.add("implementation", catalog.findLibrary(library).get())
            }
        }
}
