package com.agentplayground.app

import android.app.Application
import com.agentplayground.domain.repository.PreferencesRepository
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject

@HiltAndroidApp
class PlaygroundApplication : Application() {
    @Inject lateinit var preferences: PreferencesRepository
}
