package com.agentplayground.app

import android.app.Application
import com.agentplayground.data.PreferencesRepository

class PlaygroundApplication : Application() {
    val preferences by lazy { PreferencesRepository(this) }
}
