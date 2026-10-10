pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)

    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "AgentPlaygroundAndroid"

include(":app", ":core", ":data", ":ui")

include(":feature:conversation", ":feature:knowledge", ":feature:memory", ":feature:settings")
