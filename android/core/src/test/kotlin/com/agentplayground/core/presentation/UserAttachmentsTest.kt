package com.agentplayground.core.presentation

import org.junit.Assert.*
import org.junit.Test

class UserAttachmentsTest {
    private val firstId = "019cd216-3624-7ad4-8f90-894fe76411ca"
    private val secondId = "019CD216-3624-7AD4-8F90-894FE76411CB"

    @Test
    fun `valid trailing envelopes decode names and preserve the authored text`() {
        val content =
            "Review this.\nKeep this line.\n\nUploaded files:\n" +
                "\"Photo \\\"one\\\".PNG\" — File ID: $firstId\n" +
                "\"资料.csv\" — File ID: $secondId"

        val presentation = userMessagePresentation(content)

        assertEquals("Review this.\nKeep this line.", presentation.text)
        assertEquals(
            listOf(
                UploadedAttachment(firstId, "Photo \"one\".PNG"),
                UploadedAttachment(secondId, "资料.csv"),
            ),
            presentation.attachments,
        )
        assertTrue(presentation.attachments.first().isImage)
        assertFalse(presentation.attachments.last().isImage)
    }

    @Test
    fun `malformed or incomplete envelopes remain ordinary user text`() {
        val invalid =
            listOf(
                "Uploaded files:\n\"notes.txt\" — File ID: $firstId",
                "Read this.\n\nUploaded files:\n",
                "Read this.\n\nUploaded files:\nnotes.txt — File ID: $firstId",
                "Read this.\n\nUploaded files:\n\"notes.txt\"  — File ID: $firstId",
                "Read this.\n\nUploaded files:\n\"notes.txt\" — File ID: 1-1-1-1-1",
                "Read this.\n\nUploaded files:\n\"../notes.txt\" — File ID: $firstId",
                "Read this.\n\nUploaded files:\n\"\\nnotes.txt\" — File ID: $firstId",
                "Read this.\n\nUploaded files:\n\"notes.txt\" — File ID: $firstId\n",
                "Read this.\n\nUploaded files:\n\"notes.txt\" — File ID: $firstId\nMore prose",
                "Read this.\n\nUploaded files:\n\"notes.txt\" — File ID: $firstId\n\"bad.txt\" — File ID: bad",
            )

        for (content in invalid) {
            val presentation = userMessagePresentation(content)

            assertEquals(content, presentation.text)
            assertTrue(presentation.attachments.isEmpty())
        }
    }

    @Test
    fun `only supported image suffixes offer previews`() {
        for (name in listOf("one.JPEG", "two.jpg", "three.png", "four.gif", "five.webp")) {
            assertTrue(name, isPreviewImage(name))
        }

        for (name in listOf("notes.txt", "vector.svg", "image.png.txt", "gif", "photo.heic")) {
            assertFalse(name, isPreviewImage(name))
        }
    }
}
