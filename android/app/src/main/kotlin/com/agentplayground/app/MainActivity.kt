package com.agentplayground.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.graphics.luminance
import androidx.core.view.WindowCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.agentplayground.app.navigation.PlaygroundApp
import com.agentplayground.ui.PlaygroundTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val application = application as PlaygroundApplication

        setContent {
            val preferences by
                application.preferences.preferences.collectAsStateWithLifecycle(initialValue = null)

            preferences?.let { value ->
                PlaygroundTheme(value.theme) {
                    val lightBars = MaterialTheme.colorScheme.surface.luminance() > 0.5f

                    SideEffect {
                        WindowCompat.getInsetsController(window, window.decorView).apply {
                            isAppearanceLightStatusBars = lightBars
                            isAppearanceLightNavigationBars = lightBars
                        }
                    }

                    PlaygroundApp(application, value)
                }
            }
        }
    }
}
