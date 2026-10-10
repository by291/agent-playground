import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.api.artifacts.VersionCatalogsExtension
import org.gradle.kotlin.dsl.getByType

class AndroidHiltConventionPlugin : Plugin<Project> {
    override fun apply(target: Project): Unit =
        with(target) {
            pluginManager.apply("com.google.devtools.ksp")
            pluginManager.apply("com.google.dagger.hilt.android")

            val catalog = extensions.getByType<VersionCatalogsExtension>().named("libs")
            dependencies.add("implementation", catalog.findLibrary("hilt-android").get())
            dependencies.add("ksp", catalog.findLibrary("hilt-compiler").get())
            Unit
        }
}
