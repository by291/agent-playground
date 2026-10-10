"""Exercise authenticated management routes without starting background workers."""

import asyncio
from uuid import uuid4

import httpx
import pytest
from aegra_api.core.database import db_manager

from agent_playground.http import app
from agent_playground.memory.service import MemoryService
from tests.agent_config import update_agent_config
from tests.memory_fixtures import remember

AUTHORIZATION = {"Authorization": "Bearer memory-route-test"}


@pytest.fixture
def memory_api(memory_service: MemoryService, monkeypatch: pytest.MonkeyPatch):
    update_agent_config("workflow", api_token="memory-route-test")
    monkeypatch.setattr(db_manager, "get_store", lambda: memory_service.store)

    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://agent",
        headers=AUTHORIZATION,
    )


def test_memory_management_requires_the_private_application_credential():
    async def check():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://agent"
        ) as client:
            response = await client.get("/memory")

        assert response.status_code == 401

    asyncio.run(check())


def test_management_edits_preserve_source_and_reject_stale_changes(
    memory_service: MemoryService,
    memory_api: httpx.AsyncClient,
):
    async def check():
        memory = await remember(memory_service, "Prefer detailed answers.")
        mutation = {"category": "preference", "project": None, "revision": 1}

        async with memory_api as client:
            listed = await client.get("/memory")
            corrected = await client.patch(
                f"/memory/{memory.id}",
                json={**mutation, "text": "Prefer concise answers."},
            )
            stale_edit = await client.patch(
                f"/memory/{memory.id}",
                json={**mutation, "text": "An older correction."},
            )
            stale_delete = await client.request(
                "DELETE", f"/memory/{memory.id}", json=mutation
            )

        assert listed.status_code == 200
        assert listed.json()["items"][0]["id"] == memory.id
        assert listed.json()["nextOffset"] is None
        assert corrected.status_code == 200
        assert corrected.json()["text"] == "Prefer concise answers."
        assert corrected.json()["revision"] == 2
        assert corrected.json()["sourceThreadId"] == memory.source_thread_id
        assert corrected.json()["sourceMessageId"] == memory.source_message_id
        assert stale_edit.status_code == stale_delete.status_code == 409

    asyncio.run(check())


def test_management_forget_is_retry_safe_and_removes_content(
    memory_service: MemoryService,
    memory_api: httpx.AsyncClient,
):
    async def check():
        memory = await remember(memory_service, "Use PostgreSQL.", project="Playground")
        mutation = {"category": "project", "project": "Playground", "revision": 1}

        async with memory_api as client:
            removed = await client.request(
                "DELETE", f"/memory/{memory.id}", json=mutation
            )
            repeated = await client.request(
                "DELETE", f"/memory/{memory.id}", json=mutation
            )
            listed = await client.get("/memory")
            stale_edit = await client.patch(
                f"/memory/{memory.id}", json={**mutation, "text": "Use SQLite."}
            )
            missing = await client.request(
                "DELETE", f"/memory/{uuid4()}", json=mutation
            )

        assert removed.status_code == repeated.status_code == 204
        assert listed.json() == {"items": [], "nextOffset": None}
        assert stale_edit.status_code == 409
        assert missing.status_code == 404

    asyncio.run(check())


@pytest.mark.parametrize(
    "query", ["limit=101", "limit=0", "offset=-1", "offset=1000001"]
)
def test_management_rejects_invalid_pagination(
    query: str, memory_api: httpx.AsyncClient
):
    async def check():
        async with memory_api as client:
            response = await client.get(f"/memory?{query}")

        assert response.status_code == 422

    asyncio.run(check())


@pytest.mark.parametrize(
    "invalid",
    [
        {"text": "   "},
        {"text": "x" * 1001},
        {"text": "😀" * 501},
        {"revision": 0},
        {"revision": True},
        {"revision": "1"},
        {"revision": 9_007_199_254_740_992},
        {"category": "project", "project": None},
        {"project": "unexpected"},
        {"sourceThreadId": "untrusted"},
    ],
)
def test_management_rejects_invalid_edits(
    invalid: dict[str, object], memory_api: httpx.AsyncClient
):
    async def check():
        request = {
            "category": "preference",
            "project": None,
            "revision": 1,
            "text": "A fact.",
        }

        async with memory_api as client:
            response = await client.patch(
                f"/memory/{uuid4()}", json={**request, **invalid}
            )

        assert response.status_code == 422

    asyncio.run(check())
