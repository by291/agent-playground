package com.agentplayground.app

import android.app.Application
import com.agentplayground.app.data.PreferenceStore

class PlaygroundApplication : Application() {
    val preferences by lazy { PreferenceStore(this) }
}
