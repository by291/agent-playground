"""Memory persistence through LangMem and the runtime-owned LangGraph Store."""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from uuid import UUID

import psycopg
from langgraph.store.base import BaseStore
from langmem import create_manage_memory_tool

from agent_playground.config import load_agent_config
from agent_playground.memory.models import (
    MEMORY_ROOT,
    MemoryContent,
    MemoryPage,
    MemoryScope,
    MemoryView,
    memory_namespace,
    memory_view,
)


@asynccontextmanager
async def record_lock(key: str):
    # Store writes use their own transactions. This lock serializes our complete
    # read/check/write operation across processes, including management requests.
    url = load_agent_config().database.aegra_url.get_secret_value()

    async with await psycopg.AsyncConnection.connect(
        url, connect_timeout=5
    ) as connection:
        await connection.execute("SET LOCAL lock_timeout = '5s'")
        await connection.execute(
            "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (key,)
        )

        yield


class MemoryService:
    def __init__(self, store: BaseStore):
        self.store = store

    async def list_memories(self, *, offset: int = 0, limit: int = 50) -> MemoryPage:
        rows = await self.store.asearch(
            MEMORY_ROOT,
            filter={"content": {"$ne": None}},
            limit=limit + 1,
            offset=offset,
        )
        items = [memory for row in rows[:limit] if (memory := memory_view(row))]

        return MemoryPage(
            items=items, nextOffset=offset + limit if len(rows) > limit else None
        )

    async def recall(self, scope: MemoryScope) -> list[MemoryView]:
        rows = await self.store.asearch(
            memory_namespace(scope), filter={"content": {"$ne": None}}, limit=100
        )
        memories = [memory for row in rows if (memory := memory_view(row))]

        return sorted(memories, key=lambda memory: memory.updated_at, reverse=True)

    async def save(
        self,
        scope: MemoryScope,
        text: str,
        memory_id: str,
        *,
        revision: int | None = None,
        source_thread_id: str | None = None,
        source_message_id: str | None = None,
    ) -> MemoryView:
        memory_id = str(UUID(memory_id))
        namespace = memory_namespace(scope)
        lock_key = json.dumps([*namespace, memory_id])

        async with record_lock(lock_key):
            previous = await self.store.aget(namespace, memory_id)

            if previous is not None and previous.value.get("deleted") is True:
                raise ValueError(
                    "This memory was forgotten; create a new memory instead"
                )

            existing = memory_view(previous) if previous is not None else None
            content = MemoryContent(
                category=scope.category,
                project=scope.project,
                text=text,
                revision=(existing.revision + 1) if existing is not None else 1,
                sourceThreadId=source_thread_id,
                sourceMessageId=source_message_id,
            )

            if revision is None and existing is not None:
                same_creation = (
                    existing.text == content.text
                    and existing.source_thread_id == source_thread_id
                    and existing.source_message_id == source_message_id
                )

                if same_creation:
                    return existing

                raise ValueError("Memory creation identity conflict")

            if revision is not None:
                if existing is None:
                    raise LookupError("Memory not found")

                if revision != existing.revision:
                    raise ValueError("This memory changed; refresh it before editing")

                if source_thread_id is None:
                    content.source_thread_id = existing.source_thread_id
                    content.source_message_id = existing.source_message_id

            # LangMem's update operation is an upsert. Reserve the identity here
            # rather than letting its create operation generate a retry-unsafe UUID.
            manager = create_manage_memory_tool(
                namespace,
                store=self.store,
                schema=MemoryContent,
                actions_permitted=("update",),
            )
            await manager.ainvoke(
                {
                    "action": "update",
                    "id": memory_id,
                    "content": content.model_dump(by_alias=True),
                }
            )
            stored = await self.store.aget(namespace, memory_id)

            if stored is None:
                raise RuntimeError("Memory write did not persist")

            saved = memory_view(stored)

            if saved is None:
                raise RuntimeError("Memory write returned a deleted record")

            return saved

    async def forget(
        self, scope: MemoryScope, memory_id: str, *, revision: int
    ) -> None:
        memory_id = str(UUID(memory_id))
        namespace = memory_namespace(scope)

        async with record_lock(json.dumps([*namespace, memory_id])):
            previous = await self.store.aget(namespace, memory_id)

            if previous is None:
                raise LookupError("Memory not found")

            if previous.value.get("deleted") is True:
                return

            memory = memory_view(previous)

            if memory is None or memory.revision != revision:
                raise ValueError("This memory changed; refresh it before forgetting")

            # Remove remembered content while retaining the retry fence.
            await self.store.aput(
                namespace,
                memory_id,
                {"deleted": True, "revision": revision + 1},
                index=False,
            )
