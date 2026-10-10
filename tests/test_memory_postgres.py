"""Exercise real shared storage, advisory locks and deletion retry fences."""

import asyncio
from uuid import uuid4

import pytest
from langgraph.store.postgres.aio import AsyncPostgresStore

from agent_playground.memory.models import MemoryScope, MemoryView, memory_namespace
from agent_playground.memory.service import MemoryService
from tests.agent_config import update_agent_config


def test_shared_postgres_memory_serializes_edits_and_preserves_forgetting(
    postgres_database_url: str,
):
    update_agent_config("database", aegra_url=postgres_database_url)

    async def check():
        scope = MemoryScope(category="preference")
        identity = str(uuid4())

        async with AsyncPostgresStore.from_conn_string(
            postgres_database_url
        ) as first_store:
            await first_store.setup()
            first = MemoryService(first_store)
            original = await first.save(scope, "Prefer detailed answers.", identity)

            async with AsyncPostgresStore.from_conn_string(
                postgres_database_url
            ) as second_store:
                second = MemoryService(second_store)

                assert (await second.recall(scope))[0].text == original.text

                results = await asyncio.gather(
                    first.save(scope, "Prefer concise answers.", identity, revision=1),
                    second.save(scope, "Prefer examples.", identity, revision=1),
                    return_exceptions=True,
                )
                saved = [result for result in results if isinstance(result, MemoryView)]
                conflicts = [
                    result for result in results if isinstance(result, ValueError)
                ]

                assert len(saved) == len(conflicts) == 1
                assert saved[0].revision == 2
                assert (await second.recall(scope))[0].text == saved[0].text

                await second.forget(scope, identity, revision=2)

        async with AsyncPostgresStore.from_conn_string(
            postgres_database_url
        ) as reloaded_store:
            reloaded = MemoryService(reloaded_store)
            page = await reloaded.list_memories()

            assert page.items == []
            assert page.next_offset is None
            assert await reloaded.recall(scope) == []

            tombstone = await reloaded_store.aget(memory_namespace(scope), identity)

            assert tombstone is not None
            assert tombstone.value == {"deleted": True, "revision": 3}

            with pytest.raises(ValueError, match="forgotten"):
                await reloaded.save(scope, original.text, identity)

    asyncio.run(check())
