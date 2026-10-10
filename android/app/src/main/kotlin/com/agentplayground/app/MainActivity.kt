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
import com.agentplayground.design.PlaygroundTheme
import com.agentplayground.domain.repository.PreferencesRepository
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    @Inject lateinit var preferences: PreferencesRepository

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        setContent {
            val currentPreferences by
                preferences.preferences.collectAsStateWithLifecycle(initialValue = null)

            currentPreferences?.let { value ->
                PlaygroundTheme(value.theme) {
                    val lightBars = MaterialTheme.colorScheme.surface.luminance() > 0.5f

                    SideEffect {
                        WindowCompat.getInsetsController(window, window.decorView).apply {
                            isAppearanceLightStatusBars = lightBars
                            isAppearanceLightNavigationBars = lightBars
                        }
                    }

                    PlaygroundApp(value)
                }
            }
        }
    }
}
