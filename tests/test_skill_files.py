"""Keep published output references when a later file transfer fails."""

import asyncio
import json
from typing import Any

import httpx
import pytest

from agent_playground.skills.files import SkillFileClient


def test_partial_output_publication_keeps_completed_file_links(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv("WORKFLOW_API_TOKEN", "test-token")
    requests: list[dict[str, Any]] = []

    def respond(request: httpx.Request):
        body = json.loads(request.content)
        requests.append(body)
        assert request.headers["Authorization"] == "Bearer test-token"

        if len(requests) == 2:
            return httpx.Response(503, json={"error": "Storage unavailable"})

        return httpx.Response(
            201,
            json={
                "id": body["id"],
                "threadId": body["threadId"],
                "name": body["name"],
                "size": 3,
            },
        )

    original_client = httpx.AsyncClient

    def client(**kwargs: Any):
        return original_client(**kwargs, transport=httpx.MockTransport(respond))

    monkeypatch.setattr("agent_playground.skills.files.httpx.AsyncClient", client)

    async def check():
        files, error = await SkillFileClient(
            "test-thread", "test-run", "test-call"
        ).publish({"first.txt": b"one", "second.txt": b"two"})

        assert [file.name for file in files] == ["first.txt"]
        assert error and "503" in error
        assert requests[0]["runId"] == "test-run"

    asyncio.run(check())
