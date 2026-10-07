"""Exercise external waits without a browser or business-specific review fields."""

import asyncio
import json
from typing import Any

import httpx
import pytest
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command
from pydantic import BaseModel, Field

from agent_playground.workflows import external
from agent_playground.workflows.external import wait_for_external_task
from tests.agent_config import update_agent_config


class WaitState(BaseModel):
    result: dict[str, Any] = Field(default_factory=dict)


@pytest.mark.parametrize(
    "status, task_id, valid",
    [
        ("succeeded", "task", True),
        ("failed", "task", True),
        ("running", "task", False),
        ("succeeded", "other", False),
    ],
)
def test_external_wait_accepts_only_the_target_task_terminal_result(
    status: str, task_id: str, valid: bool
):
    async def run():
        def wait(state: dict[str, object]):
            result = wait_for_external_task(task_id="task", workflow_call_id="call")
            return {"result": result.model_dump()}

        builder = StateGraph(WaitState)
        builder.add_node("wait", wait)
        builder.add_edge(START, "wait")
        builder.add_edge("wait", END)
        graph = builder.compile(checkpointer=InMemorySaver())
        config = {"configurable": {"thread_id": "external"}}
        paused = await graph.ainvoke({}, config)

        assert paused["__interrupt__"][0].value == {
            "kind": "workflow_external_wait",
            "taskId": "task",
            "workflowCallId": "call",
        }
        response = {
            "kind": "external_task_result",
            "taskId": task_id,
            "revision": 3,
            "status": status,
            "result": {"artifact": "ready"},
            "error": "Task failed",
        }

        if valid:
            completed = await graph.ainvoke(Command(resume=response), config)
            assert completed["result"]["status"] == status
        else:
            with pytest.raises(ValueError):
                await graph.ainvoke(Command(resume=response), config)

    asyncio.run(run())


def test_registration_identity_survives_a_new_run(monkeypatch: pytest.MonkeyPatch):
    requests: list[dict[str, Any]] = []

    def register(request: httpx.Request):
        assert request.headers["Authorization"] == "Bearer internal-token"
        body = json.loads(request.content)
        requests.append(body)
        return httpx.Response(
            200, json={"taskId": body["taskId"], "callbackToken": "callback-token"}
        )

    client_class = httpx.AsyncClient
    transport = httpx.MockTransport(register)

    def client_factory(**kwargs: Any):
        return client_class(transport=transport, **kwargs)

    monkeypatch.setattr(external.httpx, "AsyncClient", client_factory)
    update_agent_config("workflow", api_token="internal-token")

    async def run():
        async def submit(state: WaitState):
            registration = await external.register_external_task(
                workflow_call_id="call", step_id="build", label="Build artifact"
            )
            return {"result": {"taskId": registration.task_id}}

        builder = StateGraph(WaitState)
        builder.add_node("submit", submit)
        builder.add_edge(START, "submit")
        builder.add_edge("submit", END)
        graph = builder.compile()
        first = await graph.ainvoke(
            {},
            {
                "configurable": {"thread_id": "thread"},
                "metadata": {"agui_run_id": "first"},
            },
        )
        replay = await graph.ainvoke(
            {},
            {
                "configurable": {"thread_id": "thread"},
                "metadata": {"agui_run_id": "replay"},
            },
        )
        assert first["result"]["taskId"] == replay["result"]["taskId"]
        assert [request["runId"] for request in requests] == ["first", "replay"]
        assert requests[0]["taskId"] == requests[1]["taskId"]

    asyncio.run(run())
