"""A2A waits resume using backend-owned results and preserve submission identity."""

import asyncio
import json
from typing import Any

import httpx
import pytest
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command


@pytest.mark.parametrize(
    ("status", "title", "receipt"),
    [
        (
            "succeeded",
            "A2A collaboration completed",
            "The full revision is available in the agent output.",
        ),
        ("failed", "A2A collaboration failed", "Reviewer unavailable"),
        (
            "cancelled",
            "A2A collaboration cancelled",
            "The agent collaboration was cancelled.",
        ),
    ],
)
def test_a2a_workflow_waits_and_publishes_compact_completion_receipt(
    monkeypatch: pytest.MonkeyPatch,
    status: str,
    title: str,
    receipt: str,
):
    from agent_playground.workflows.a2a import graph as module
    from agent_playground.workflows.a2a.models import A2aState
    from agent_playground.workflows.external import ExternalTaskRegistration

    submissions = []
    outputs = []
    markdown = "## Revised proposal\n\n### Ownership\n\n| Owner | Task |\n| --- | --- |\n| Alice | Deliver |\n\nFinal notes.\n"

    async def register(**kwargs: Any):
        return ExternalTaskRegistration(taskId="job", callbackToken="secret")

    async def submit(self: module.HttpA2aApi, **kwargs: Any):
        submissions.append(kwargs)

    async def publish(**kwargs: Any):
        outputs.append(kwargs)

    monkeypatch.setattr(module, "register_external_task", register)
    monkeypatch.setattr(module.HttpA2aApi, "submit", submit)
    monkeypatch.setattr(module, "publish_workflow_output", publish)

    async def run():
        graph = module.make_a2a_workflow(checkpointer=InMemorySaver())
        config = {"configurable": {"thread_id": "thread"}}
        await graph.ainvoke(
            A2aState(task="Order plan", workflow_call_id="call"), config
        )
        snapshot = await graph.aget_state(config)
        assert snapshot.interrupts[0].value["taskId"] == "job"
        result = await graph.ainvoke(
            Command(
                resume={
                    snapshot.interrupts[0].id: {
                        "kind": "external_task_result",
                        "taskId": "job",
                        "revision": 2,
                        "status": status,
                        "result": {"summary": markdown},
                        "error": "Reviewer unavailable" if status == "failed" else None,
                    }
                }
            ),
            config,
        )
        assert result["status"] == status
        assert len(submissions) == 1
        assert submissions[0]["task_id"] == "job"
        assert len(outputs) == 1
        output = outputs[0]
        card = output["card"].model_dump(by_alias=True)
        components = card["messages"][1]["updateComponents"]["components"]
        texts = [
            component["text"]
            for component in components
            if component["component"] == "WorkflowText"
        ]
        assert title in texts
        assert receipt in texts
        assert len(texts) == 3
        assert all(
            component["component"] != "WorkflowSteps" for component in components
        )
        assert all(component.get("role") != "step" for component in components)
        assert "Revised proposal" not in json.dumps(card)
        assert "| Owner |" not in json.dumps(card)
        assert output["workflow_call_id"] == "call"
        assert output["step_id"] == "result"
        assert output["step_seq"] == 1
        assert output["workflow"].presentation.surface_id == "a2a-call-result"
        assert output["workflow"].presentation.group_id == "call"

    asyncio.run(run())


def test_lost_submission_response_is_reconciled_before_waiting(
    monkeypatch: pytest.MonkeyPatch,
):
    from agent_playground.workflows.a2a.api import HttpA2aApi

    accepted = False
    writes = []
    client_class = httpx.AsyncClient

    def handle(request: httpx.Request):
        nonlocal accepted

        if request.method == "GET":
            return (
                httpx.Response(
                    200,
                    json={"jobId": "job", "task": "Order plan", "requireInput": False},
                )
                if accepted
                else httpx.Response(404)
            )

        writes.append(json.loads(request.content))
        accepted = True
        raise httpx.ReadTimeout("Accepted response was lost", request=request)

    def controlled_client(**kwargs: Any) -> httpx.AsyncClient:
        return client_class(transport=httpx.MockTransport(handle), **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", controlled_client)
    asyncio.run(
        HttpA2aApi().submit(
            task_id="job",
            task="Order plan",
            callback_token="secret",
            require_input=False,
        )
    )
    assert len(writes) == 1
    assert writes[0]["id"] == "job"


@pytest.mark.parametrize("task", ["", "   ", "x" * 10001])
def test_invalid_submission_publishes_terminal_failure(
    monkeypatch: pytest.MonkeyPatch, task: str
):
    from agent_playground.workflows.a2a.api import HttpA2aApi

    callbacks = []
    client_class = httpx.AsyncClient

    def handle(request: httpx.Request):
        assert request.headers["Authorization"] == "Bearer secret"
        callbacks.append(json.loads(request.content))

        return httpx.Response(200)

    def controlled_client(**kwargs: Any) -> httpx.AsyncClient:
        return client_class(transport=httpx.MockTransport(handle), **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", controlled_client)
    asyncio.run(
        HttpA2aApi().submit(
            task_id="job", task=task, callback_token="secret", require_input=False
        )
    )
    assert len(callbacks) == 1
    assert callbacks[0]["kind"] == "a2a"
    assert callbacks[0]["status"] == "failed"


def test_ambiguous_write_is_not_failed_by_a_later_rejection(
    monkeypatch: pytest.MonkeyPatch,
):
    from agent_playground.workflows.a2a.api import HttpA2aApi

    writes = 0
    client_class = httpx.AsyncClient

    def handle(request: httpx.Request):
        nonlocal writes

        if request.method == "GET":
            return httpx.Response(404)

        assert request.url.path.endswith("/jobs")
        writes += 1

        if writes == 1:
            raise httpx.ReadTimeout("Unknown write outcome", request=request)

        return httpx.Response(409)

    def controlled_client(**kwargs: Any) -> httpx.AsyncClient:
        return client_class(transport=httpx.MockTransport(handle), **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", controlled_client)

    with pytest.raises(httpx.HTTPStatusError):
        asyncio.run(
            HttpA2aApi().submit(
                task_id="job", task="Plan", callback_token="secret", require_input=False
            )
        )

    assert writes == 2
