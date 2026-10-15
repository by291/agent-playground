"""Exercise autonomous plans through the existing agent and checkpoint lifecycle."""

import asyncio
from typing import Any

import pytest
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.tools import tool
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command, interrupt

from agent_playground.graph import make_graph
from tests.model_config import ModelConfigFile
from tests.test_context import RecordingModel


def plan_call(call_id: str, todos: list[dict[str, str]]) -> AIMessage:
    return AIMessage(
        content="",
        tool_calls=[{"id": call_id, "name": "write_todos", "args": {"todos": todos}}],
    )


def invoke(graph: Any, inputs: Any, config: dict[str, Any], asynchronous: bool):
    if asynchronous:
        return asyncio.run(graph.ainvoke(inputs, config))

    return graph.invoke(inputs, config)


@pytest.mark.parametrize("asynchronous", [False, True])
def test_agent_executes_tools_and_revises_its_own_plan(asynchronous: bool):
    initial = [{"content": "Check the clock", "status": "in_progress"}]
    revised = [
        {"content": "Check the clock", "status": "completed"},
        {"content": "Explain the timestamp", "status": "completed"},
    ]
    model = RecordingModel(
        responses=[
            plan_call("initial-plan", initial),
            AIMessage(
                content="",
                tool_calls=[{"id": "clock", "name": "get_current_time", "args": {}}],
            ),
            plan_call("revised-plan", revised),
            AIMessage(content="The timestamp was checked and explained."),
        ]
    )
    graph = make_graph(model=model, checkpointer=InMemorySaver())
    config = {"configurable": {"thread_id": "planning"}}

    result = invoke(
        graph,
        {"messages": [HumanMessage(content="Check and explain the time.")]},
        config,
        asynchronous,
    )

    assert result.get("todos") == revised
    assert result["messages"][-1].content == "The timestamp was checked and explained."
    transcript = graph.get_state(config).values["response_messages"]
    assert any(
        isinstance(message, ToolMessage) and message.name == "get_current_time"
        for message in transcript
    )
    assert [
        message.tool_call_id
        for message in transcript
        if isinstance(message, ToolMessage) and message.name == "write_todos"
    ] == ["initial-plan", "revised-plan"]


@pytest.mark.parametrize("asynchronous", [False, True])
def test_active_plan_survives_compaction_and_graph_recreation(
    model_config: ModelConfigFile, asynchronous: bool
):
    model_config.chat(max_input_tokens=24000)
    model_config.settings["chat"]["compact_ratio"] = 0.6
    model_config.save()
    todos = [{"content": "Retrieve Cedar source evidence", "status": "in_progress"}]
    saver = InMemorySaver()
    config = {"configurable": {"thread_id": "planning-compaction"}}
    first = make_graph(
        model=RecordingModel(
            responses=[plan_call("plan", todos), AIMessage(content="Working.")]
        ),
        checkpointer=saver,
    )
    invoke(
        first,
        {"messages": [HumanMessage(content="Investigate Cedar.")]},
        config,
        asynchronous,
    )
    model = RecordingModel(
        responses=[AIMessage(content="Continuing the investigation.")]
    )
    recreated = make_graph(
        model=model,
        summary_model=RecordingModel(
            responses=[AIMessage(content="The user requested an investigation.")]
        ),
        checkpointer=saver,
    )

    result = invoke(
        recreated,
        {
            "messages": [
                HumanMessage(content="Background detail " * 3200),
                AIMessage(content="Noted."),
                HumanMessage(content="Continue."),
            ]
        },
        config,
        asynchronous,
    )

    assert result["context_usage"]["compactions"] > 0
    assert result.get("todos") == todos
    system = next(
        message for message in model._inputs[-1] if isinstance(message, SystemMessage)
    )
    assert "Retrieve Cedar source evidence" in str(system.content)
    assert not any(
        isinstance(message, ToolMessage) and message.name == "write_todos"
        for message in model._inputs[-1]
    )


def test_oversized_plan_is_rejected_without_overwriting_saved_progress(
    model_config: ModelConfigFile,
):
    model_config.chat(max_input_tokens=64000)
    model_config.save()
    original = [{"content": "Inspect the source", "status": "in_progress"}]
    oversized = [{"content": "Detailed instruction " * 3000, "status": "in_progress"}]
    model = RecordingModel(
        responses=[
            plan_call("initial", original),
            plan_call("oversized", oversized),
            AIMessage(content="I will retain the concise plan."),
        ]
    )
    graph = make_graph(model=model)

    result = graph.invoke(
        {"messages": [HumanMessage(content="Investigate the source.")]}
    )

    assert result.get("todos") == original
    rejection = next(
        message
        for message in result["messages"]
        if isinstance(message, ToolMessage) and message.tool_call_id == "oversized"
    )
    assert rejection.status == "error"
    assert "shorten" in str(rejection.content).lower()


def test_resume_keeps_the_plan_and_archives_its_completed_update():
    @tool
    def request_input() -> str:
        """Wait for the user's input before continuing the current task."""
        return str(interrupt("Which source should I use?"))

    request_input.metadata = {"readOnlyHint": True}

    todos = [{"content": "Confirm the source", "status": "in_progress"}]
    saver = InMemorySaver()
    config = {"configurable": {"thread_id": "planning-resume"}}
    first = make_graph(
        model=RecordingModel(
            responses=[
                plan_call("initial", todos),
                AIMessage(
                    content="",
                    tool_calls=[{"id": "input", "name": "request_input", "args": {}}],
                ),
            ]
        ),
        checkpointer=saver,
        mcp_tools=[request_input],
    )
    paused = first.invoke(
        {"messages": [HumanMessage(content="Confirm a source.")]}, config
    )

    assert paused.get("todos") == todos
    assert paused["__interrupt__"]
    completed = [{"content": "Confirm the source", "status": "completed"}]
    model = RecordingModel(
        responses=[
            plan_call("complete", completed),
            AIMessage(content="Source confirmed."),
        ]
    )
    recreated = make_graph(model=model, checkpointer=saver, mcp_tools=[request_input])
    result = recreated.invoke(Command(resume="Cedar"), config)

    assert result.get("todos") == completed
    assert "Confirm the source" in str(model._inputs[0][0].content)
    assert any(
        isinstance(message, ToolMessage) and message.tool_call_id == "complete"
        for message in recreated.get_state(config).values["response_messages"]
    )
