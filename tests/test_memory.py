"""Exercise memory policy using real LangGraph stores and controlled models."""

import asyncio
from uuid import uuid4

import pytest

from agent_playground.memory.models import memory_namespace
from agent_playground.memory.service import MemoryService
from tests.memory_fixtures import remember, scope


def test_new_conversation_reads_shared_preferences(memory_service: MemoryService):
    async def check():
        saved = await remember(memory_service, "Prefer concise answers.")
        other_instance = type(memory_service)(memory_service.store)
        memories = await other_instance.recall(scope())

        assert [memory.text for memory in memories] == ["Prefer concise answers."]
        assert memories[0].source_thread_id == "thread-one"
        assert memories[0].id == saved.id

    asyncio.run(check())


def test_project_scopes_are_isolated_and_normalized(memory_service: MemoryService):
    async def check():
        await remember(memory_service, "Use PostgreSQL.", project="Agent Playground")
        await remember(memory_service, "Use SQLite.", project="Other App")

        memories = await memory_service.recall(scope("project", " agent playground "))

        assert [memory.text for memory in memories] == ["Use PostgreSQL."]
        assert await memory_service.recall(scope()) == []

    asyncio.run(check())


def test_replayed_create_is_idempotent(memory_service: MemoryService):
    async def check():
        memory_id = str(uuid4())
        first = await remember(
            memory_service, "Prefer concise answers.", memory_id=memory_id
        )
        repeated = await remember(
            memory_service, "Prefer concise answers.", memory_id=memory_id
        )

        assert repeated.revision == 1
        assert repeated.updated_at == first.updated_at
        assert len(await memory_service.recall(scope())) == 1

    asyncio.run(check())


def test_stale_edit_cannot_overwrite_a_newer_memory(memory_service: MemoryService):
    async def check():
        saved = await remember(memory_service, "Prefer concise answers.")
        edited = await memory_service.save(
            scope(), "Explain details.", saved.id, revision=1
        )

        with pytest.raises(ValueError, match="changed"):
            await memory_service.save(
                scope(), "Use bullet points.", saved.id, revision=1
            )

        assert edited.revision == 2
        assert (await memory_service.recall(scope()))[0].text == "Explain details."

    asyncio.run(check())


def test_forgetting_prevents_create_retries_from_restoring_content(
    memory_service: MemoryService,
):
    async def check():
        saved = await remember(memory_service, "Prefer concise answers.")
        await memory_service.forget(scope(), saved.id, revision=1)
        await memory_service.forget(scope(), saved.id, revision=1)

        with pytest.raises(ValueError, match="forgotten"):
            await remember(
                memory_service, "Prefer concise answers.", memory_id=saved.id
            )

        assert await memory_service.recall(scope()) == []
        raw = await memory_service.store.aget(memory_namespace(scope()), saved.id)

        assert raw is not None
        assert "Prefer concise answers." not in str(raw.value)

    asyncio.run(check())


def test_listing_advances_past_tombstones(memory_service: MemoryService):
    async def check():
        first = await remember(memory_service, "Prefer concise answers.")
        await remember(memory_service, "Prefer English code.")
        await remember(memory_service, "Prefer established libraries.")
        await memory_service.forget(scope(), first.id, revision=1)
        first_page = await memory_service.list_memories(offset=0, limit=1)
        assert first_page.next_offset is not None
        second_page = await memory_service.list_memories(
            offset=first_page.next_offset, limit=1
        )

        assert first_page.next_offset == 1
        assert len(first_page.items) + len(second_page.items) == 2
        assert second_page.next_offset is None

    asyncio.run(check())


def test_project_fact_requires_a_project_name():
    with pytest.raises(ValueError):
        scope("project")

    with pytest.raises(ValueError):
        scope("preference", "Other App")
