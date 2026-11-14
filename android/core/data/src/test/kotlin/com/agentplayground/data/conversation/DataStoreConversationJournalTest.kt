package com.agentplayground.data.conversation

import androidx.datastore.preferences.core.*
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import com.agentplayground.domain.model.SavedConversation
import com.agentplayground.domain.model.protocolJson
import java.io.File
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import kotlinx.serialization.encodeToString
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

// The Android DataStore artifact selects its file replacement API from the runtime SDK.
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class DataStoreConversationJournalTest {
    @get:Rule val temporary = TemporaryFolder()

    @Test
    fun `existing journal keys remain readable and clearing one server preserves another`() =
        runBlocking {
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
            val store =
                PreferenceDataStoreFactory.create(scope = scope) {
                    File(temporary.root, "agent_playground.preferences_pb")
                }
            val server = "https://example.com/workspace/"
            val otherServer = "https://example.com/workspace/:another/"
            val original =
                SavedConversation("thread:part", draft = "Preserved draft", modelId = "qwen")
            val other = SavedConversation("thread", draft = "Another draft")
            val journal = DataStoreConversationJournal(store, server)
            val otherJournal = DataStoreConversationJournal(store, otherServer)

            try {
                // Seed the pre-refactor schema rather than round-tripping only through the new
                // writer.
                store.edit {
                    it[stringPreferencesKey("preferences")] = "unchanged preferences"
                    it[stringPreferencesKey("selected:$server")] = original.threadId
                    it[stringPreferencesKey("thread:$server:${original.threadId}")] =
                        protocolJson.encodeToString(original)
                }

                otherJournal.write(other)
                otherJournal.select(other.threadId)

                assertEquals(original, journal.read())
                journal.write(original.copy(draft = "New draft"))
                assertEquals("New draft", journal.find(original.threadId)?.draft)

                journal.clear()

                assertNull(journal.read())
                assertNull(journal.find(original.threadId))
                assertEquals(other, otherJournal.read())
                assertEquals(
                    "unchanged preferences",
                    store.data.first()[stringPreferencesKey("preferences")],
                )
            } finally {
                scope.cancel()
                scope.coroutineContext[Job]?.join()
            }
        }

    @Test
    fun `thread IDs that collide in the legacy schema remain isolated`() = runBlocking {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val store =
            PreferenceDataStoreFactory.create(scope = scope) {
                File(temporary.root, "agent_playground.preferences_pb")
            }
        val server = "https://example.com/workspace/"
        val otherServer = "https://example.com/workspace/:preview/"
        val original = SavedConversation("preview/:thread", draft = "Root draft")
        val other = SavedConversation("thread", draft = "Preview draft")
        val journal = DataStoreConversationJournal(store, server)
        val otherJournal = DataStoreConversationJournal(store, otherServer)

        try {
            store.edit { values ->
                values[stringPreferencesKey("selected:$server")] = original.threadId
                values[stringPreferencesKey("selected:$otherServer")] = other.threadId
                values[stringPreferencesKey("thread:$otherServer:${other.threadId}")] =
                    protocolJson.encodeToString(other)
            }

            assertNull(journal.read())
            assertNull(journal.find(original.threadId))
            assertEquals(other, otherJournal.read())

            journal.write(original)

            assertEquals(original, journal.read())
            assertEquals(other, otherJournal.read())

            journal.remove(original.threadId)

            assertNull(journal.read())
            assertEquals(other, otherJournal.read())
        } finally {
            scope.cancel()
            scope.coroutineContext[Job]?.join()
        }
    }
}
