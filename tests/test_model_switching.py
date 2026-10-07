"""Model selection follows persisted run config and provider-specific budgets."""

import asyncio
import importlib
import json
from types import SimpleNamespace
from typing import Any, cast

import httpx2 as httpx
import pytest
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.checkpoint.memory import InMemorySaver
from langgraph_sdk.runtime import ServerRuntime

from agent_playground.graph import make_graph
from agent_playground.models import create_chat_model, model_configuration
from agent_playground.workflows.sql.agent import make_revision_agent
from agent_playground.workflows.sql.models import SqlState
from tests.model_config import ModelConfigFile
from tests.test_context import RecordingModel


def test_graph_factory_uses_the_run_model_instead_of_the_current_default(
    monkeypatch: pytest.MonkeyPatch,
):
    graph_module = importlib.import_module("agent_playground.graph")
    selections: list[str | None] = []
    compiled = make_graph(model=RecordingModel(responses=[AIMessage(content="Ready.")]))

    async def selected_graph(model_id: str | None = None):
        selections.append(model_id)
        return compiled

    monkeypatch.setattr(graph_module, "base_graph", selected_graph)
    runtime = cast(
        ServerRuntime[dict[str, object]], SimpleNamespace(execution_runtime=None)
    )

    async def inspect():
        async with graph_module.graph({"configurable": {"model_id": "qwen"}}, runtime):
            pass

    asyncio.run(inspect())

    assert selections == ["qwen"]


def test_a_new_model_uses_its_own_context_budget_with_the_same_checkpoint(
    monkeypatch: pytest.MonkeyPatch,
    model_config: ModelConfigFile,
):
    graph_module = importlib.import_module("agent_playground.graph")
    model_config.chat(max_input_tokens=20000)
    model_config.chat("qwen", max_input_tokens=40000)
    first_model = RecordingModel(responses=[AIMessage(content="Project Cedar.")])
    next_model = RecordingModel(responses=[AIMessage(content="Still Cedar.")])
    models = {"deepseek": first_model, "qwen": next_model}

    def selected_model(model_id: str | None = None, *, summary: bool = False):
        return models[model_id or "deepseek"]

    monkeypatch.setattr("agent_playground.models.create_chat_model", selected_model)
    # Patch where the factory is consumed, once that boundary exists.
    monkeypatch.setattr(
        graph_module, "create_chat_model", selected_model, raising=False
    )
    saver = InMemorySaver()
    config: Any = {"configurable": {"thread_id": "model-switch"}}
    first = make_graph(model_id="deepseek", checkpointer=saver)
    first.invoke(
        {"messages": [HumanMessage(content="Remember project Cedar.")]}, config
    )
    second = make_graph(model_id="qwen", checkpointer=saver)
    result = second.invoke(
        {"messages": [HumanMessage(content="What project?")]}, config
    )

    assert result["messages"][-1].content == "Still Cedar."
    assert result["context_usage"]["contextWindow"] == 40000
    assert len(next_model._inputs[-1]) == 4
    assert any(
        message.content == "Remember project Cedar."
        for message in next_model._inputs[-1]
    )


def test_qwen_uses_chat_completions_with_tools_and_stream_usage(
    monkeypatch: pytest.MonkeyPatch,
    model_config: ModelConfigFile,
):
    model_config.chat(
        "qwen", api_key="test", base_url="https://provider.example/compatible-mode/v1"
    )
    requests: list[httpx.Request] = []

    def send(_client: httpx.Client, request: httpx.Request, **_kwargs: Any):
        requests.append(request)
        return httpx.Response(
            200,
            request=request,
            json={
                "id": "completion-1",
                "object": "chat.completion",
                "created": 1,
                "model": "qwen3.8-flash",
                "choices": [
                    {
                        "index": 0,
                        "finish_reason": "tool_calls",
                        "message": {
                            "role": "assistant",
                            "content": "",
                            "tool_calls": [
                                {
                                    "id": "clock",
                                    "type": "function",
                                    "function": {
                                        "name": "get_current_time",
                                        "arguments": "{}",
                                    },
                                }
                            ],
                        },
                    }
                ],
                "usage": {
                    "prompt_tokens": 8,
                    "completion_tokens": 2,
                    "total_tokens": 10,
                },
            },
        )

    monkeypatch.setattr(httpx.Client, "send", send)
    model = create_chat_model("qwen")
    response = model.bind_tools(
        [
            {
                "name": "get_current_time",
                "description": "UTC time",
                "parameters": {"type": "object", "properties": {}},
            }
        ]
    ).invoke("Check the time.")
    payload = json.loads(requests[0].content)

    assert (
        str(requests[0].url)
        == "https://provider.example/compatible-mode/v1/chat/completions"
    )
    assert payload["model"] == "qwen3.8-flash"
    assert payload["enable_thinking"] is False
    assert response.tool_calls[0]["name"] == "get_current_time"
    assert response.usage_metadata is not None
    assert response.usage_metadata["input_tokens"] == 8


def test_unknown_or_unconfigured_models_never_fall_back(
    model_config: ModelConfigFile,
):
    model_config.chat("qwen", api_key="")

    with pytest.raises(ValueError, match="Unknown chat model"):
        model_configuration("https://arbitrary-provider.example")

    with pytest.raises(ValueError, match="not configured"):
        create_chat_model("qwen")


def test_qwen_streams_content_and_reports_usage(
    monkeypatch: pytest.MonkeyPatch, model_config: ModelConfigFile
):
    model_config.chat("qwen", api_key="test")
    requests: list[httpx.Request] = []

    def send(_client: httpx.Client, request: httpx.Request, **_kwargs: Any):
        requests.append(request)
        chunks: list[dict[str, Any]] = [
            {
                "id": "stream-1",
                "model": "qwen3.8-flash",
                "object": "chat.completion.chunk",
                "created": 1,
                "choices": [
                    {
                        "index": 0,
                        "delta": {"role": "assistant", "content": "Hello"},
                        "finish_reason": None,
                    }
                ],
            },
            {
                "id": "stream-1",
                "model": "qwen3.8-flash",
                "object": "chat.completion.chunk",
                "created": 1,
                "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
            },
            {
                "id": "stream-1",
                "model": "qwen3.8-flash",
                "object": "chat.completion.chunk",
                "created": 1,
                "choices": [],
                "usage": {
                    "prompt_tokens": 12,
                    "completion_tokens": 1,
                    "total_tokens": 13,
                },
            },
        ]
        text = (
            "".join(f"data: {json.dumps(chunk)}\n\n" for chunk in chunks)
            + "data: [DONE]\n\n"
        )
        return httpx.Response(
            200,
            request=request,
            headers={"Content-Type": "text/event-stream"},
            text=text,
        )

    monkeypatch.setattr(httpx.Client, "send", send)
    chunks = list(create_chat_model("qwen").stream("Hello"))
    payload = json.loads(requests[0].content)

    assert payload["stream_options"] == {"include_usage": True}
    assert "".join(str(chunk.content) for chunk in chunks) == "Hello"
    usage = next(
        chunk.usage_metadata for chunk in chunks if chunk.usage_metadata is not None
    )
    assert usage["input_tokens"] == 12


@pytest.mark.parametrize("model_id", ["deepseek", "qwen"])
def test_sql_revision_disables_thinking_without_mutating_the_main_model(
    monkeypatch: pytest.MonkeyPatch,
    model_config: ModelConfigFile,
    model_id: str,
):
    model_config.chat(
        model_id, api_key="test", max_output_tokens=32768, thinking="medium"
    )
    requests: list[httpx.Request] = []

    async def send(_client: httpx.AsyncClient, request: httpx.Request, **_kwargs: Any):
        requests.append(request)
        return httpx.Response(
            200,
            request=request,
            json={
                "id": "sql-revision",
                "object": "chat.completion",
                "created": 1,
                "model": model_configuration(model_id).model,
                "choices": [
                    {
                        "index": 0,
                        "finish_reason": "tool_calls",
                        "message": {
                            "role": "assistant",
                            "content": "",
                            "tool_calls": [
                                {
                                    "id": "revision",
                                    "type": "function",
                                    "function": {
                                        "name": "SqlRevision",
                                        "arguments": '{"reply":"Selected columns.","sql":"SELECT id FROM orders"}',
                                    },
                                }
                            ],
                        },
                    }
                ],
            },
        )

    monkeypatch.setattr(httpx.AsyncClient, "send", send)
    main_model = create_chat_model(model_id)
    revise = make_revision_agent(main_model)

    async def revision():
        result = await revise(
            SqlState(task="List order IDs", workflow_call_id="workflow-1")
        )
        await main_model.ainvoke("Continue the conversation.")

        return result

    result = asyncio.run(revision())

    payload = json.loads(requests[0].content)
    assert "response_format" not in payload
    assert payload["tools"][0]["function"]["name"] == "SqlRevision"
    assert result.sql == "SELECT id FROM orders"
    assert "reasoning_effort" not in payload
    assert "thinking_budget" not in payload
    main_payload = json.loads(requests[1].content)

    if model_id == "deepseek":
        assert payload["thinking"] == {"type": "disabled"}
        assert main_payload["thinking"] == {"type": "enabled"}
        assert main_payload["reasoning_effort"] == "high"
    else:
        assert payload["enable_thinking"] is False
        assert main_payload["enable_thinking"] is True
        assert main_payload["reasoning_effort"] == "medium"
        assert "thinking_budget" not in main_payload
