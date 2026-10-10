package com.agentplayground.feature.settings

internal data class SettingsState(
    val server: String,
    val pending: Boolean = false,
    val permissionRequest: String? = null,
    val permissionDenied: Boolean = false,
    val error: String? = null,
    val status: String? = null,
    val connectedServerUrl: String? = null,
)
