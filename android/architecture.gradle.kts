import org.gradle.api.artifacts.ProjectDependency

val sharedUi = setOf(":core:domain", ":core:design", ":core:ui")
val allowedDependencies =
    mapOf(
        ":app" to
            sharedUi +
                setOf(
                    ":core:data",
                    ":feature:conversation",
                    ":feature:knowledge",
                    ":feature:memory",
                    ":feature:settings",
                ),
        ":core:domain" to emptySet(),
        ":core:data" to setOf(":core:domain"),
        ":core:design" to emptySet(),
        ":core:ui" to setOf(":core:domain", ":core:design"),
        ":feature:conversation" to sharedUi,
        ":feature:knowledge" to sharedUi,
        ":feature:memory" to sharedUi,
        ":feature:settings" to sharedUi,
    )

tasks.register("architectureCheck") {
    group = "verification"
    description = "Enforces production module boundaries and feature data access."

    doLast {
        val modules = subprojects.filter {
            it.plugins.hasPlugin("com.android.application") ||
                it.plugins.hasPlugin("com.android.library") ||
                it.plugins.hasPlugin("org.jetbrains.kotlin.jvm")
        }
        check(modules.map { it.path }.toSet() == allowedDependencies.keys) {
            "Update the architecture policy when adding or removing a maintained module."
        }

        for (module in modules) {
            val allowed = allowedDependencies.getValue(module.path)
            for (configuration in module.configurations) {
                val isTestConfiguration = configuration.name.contains("test", ignoreCase = true)
                // Android test configurations include their own tested project.
                val allowedForConfiguration =
                    when {
                        isTestConfiguration && module.path.startsWith(":feature:") ->
                            allowed + setOf(module.path, ":core:data")
                        isTestConfiguration -> allowed + module.path
                        else -> allowed
                    }

                for (dependency in
                    configuration.dependencies.withType(ProjectDependency::class.java)) {
                    check(dependency.path in allowedForConfiguration) {
                        "${module.path} must not depend on ${dependency.path} in ${configuration.name}."
                    }
                }
            }

            val forbiddenImport =
                when {
                    module.path.startsWith(":feature:") || module.path == ":core:ui" ->
                        Regex(
                            "(?m)^import (com\\.agentplayground\\.data\\.|androidx\\.datastore\\.|okhttp3\\.|retrofit2\\.)"
                        )
                    module.path == ":core:domain" ->
                        Regex("(?m)^import (android\\.|androidx\\.|okhttp3\\.|coil3\\.|dagger\\.)")
                    module.path == ":core:design" ->
                        Regex("(?m)^import com\\.agentplayground\\.(domain|data|ui|feature|app)\\.")
                    else -> null
                }

            if (forbiddenImport != null) {
                for (source in
                    module.fileTree("src") {
                        include("**/*.kt")
                        exclude(
                            "test/**",
                            "androidTest/**",
                            "testFixtures/**",
                            "*UnitTest/**",
                            "*AndroidTest/**",
                        )
                    }) {
                    check(!forbiddenImport.containsMatchIn(source.readText())) {
                        "${source.relativeTo(rootDir)} violates ${module.path} responsibility."
                    }
                }
            }
        }
    }
}
