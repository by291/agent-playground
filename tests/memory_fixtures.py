"""Owned memory stores for controlled tests; database tests use real locks."""

from contextlib import asynccontextmanager
from typing import Literal
from uuid import uuid4

import pytest
from langgraph.store.memory import InMemoryStore

from agent_playground.memory import service as service_module
from agent_playground.memory.models import MemoryScope
from agent_playground.memory.service import MemoryService


@pytest.fixture
def memory_service(monkeypatch: pytest.MonkeyPatch):
    @asynccontextmanager
    async def unlocked(_key: str):
        yield

    monkeypatch.setattr(service_module, "record_lock", unlocked)

    return MemoryService(InMemoryStore())


def scope(
    category: Literal["preference", "project"] = "preference",
    project: str | None = None,
):
    return MemoryScope(category=category, project=project)


async def remember(
    service: MemoryService,
    text: str,
    *,
    project: str | None = None,
    memory_id: str | None = None,
):
    return await service.save(
        scope("project" if project else "preference", project),
        text,
        memory_id or str(uuid4()),
        source_thread_id="thread-one",
        source_message_id="message-one",
    )
