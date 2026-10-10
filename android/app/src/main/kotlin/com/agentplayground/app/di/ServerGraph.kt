package com.agentplayground.app.di

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.ViewModelStoreOwner
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject

// The Activity retains this graph across recreation; replacing its server disposes all child
// jobs/clients.
@HiltViewModel
internal class ServerGraph @Inject constructor() : ViewModel() {
    private var serverUrl: String? = null
    private var store = ViewModelStore()
    private var currentOwner = ownerFor(store)

    fun owner(url: String): ViewModelStoreOwner {
        if (url != serverUrl) {
            store.clear()
            store = ViewModelStore()
            currentOwner = ownerFor(store)
            serverUrl = url
        }

        return currentOwner
    }

    private fun ownerFor(value: ViewModelStore) =
        object : ViewModelStoreOwner {
            override val viewModelStore = value
        }

    override fun onCleared() {
        store.clear()
    }
}
