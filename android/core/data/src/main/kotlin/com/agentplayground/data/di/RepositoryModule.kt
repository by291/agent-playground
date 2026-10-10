package com.agentplayground.data.di

import com.agentplayground.data.RepositoryFactory
import com.agentplayground.domain.repository.PreferencesRepository
import com.agentplayground.domain.repository.RepositoryProvider
import com.agentplayground.domain.repository.ServerRepository
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
internal abstract class RepositoryModule {
    @Binds abstract fun repositories(factory: RepositoryFactory): RepositoryProvider

    companion object {
        @Provides
        @Singleton
        fun preferences(factory: RepositoryFactory): PreferencesRepository = factory.preferences

        @Provides
        @Singleton
        fun server(factory: RepositoryFactory): ServerRepository = factory.server
    }
}
