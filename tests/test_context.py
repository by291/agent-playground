"""Exercise context compaction and reporting without an external model."""

import asyncio
from collections.abc import Sequence
from typing import Any, override

import pytest
from langchain_core.callbacks.manager import AsyncCallbackManagerForLLMRun
from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolMessage
from langchain_core.outputs import ChatResult
from langchain_core.tools import tool
from langgraph.checkpoint.memory import InMemorySaver
from pydantic import PrivateAttr

from agent_playground.graph import make_graph
from tests.model_config import ModelConfigFile


def test_switching_models_does_not_report_the_previous_provider_input_usage():
    from agent_playground.context import ContextMiddleware, ContextState

    model = RecordingModel(responses=[AIMessage(content="Next.")])
    middleware = ContextMiddleware(model, model, "Prompt", [])
    state: ContextState = {
        "messages": [
            AIMessage(
                content="Earlier.",
                usage_metadata={
                    "input_tokens": 900,
                    "output_tokens": 1,
                    "total_tokens": 901,
                },
            )
        ],
        "context_usage": {
            "model": "previous-model",
            "usedTokens": 900,
            "contextWindow": 10000,
            "triggerTokens": 8000,
            "breakdown": {
                "system": 0,
                "tools": 0,
                "conversation": 900,
                "toolResults": 0,
                "summary": 0,
            },
            "lastInputTokens": 900,
            "compactions": 1,
            "lastCompaction": None,
            "revision": 4,
        },
    }

    usage = middleware._usage(state, state["messages"])

    assert usage["lastInputTokens"] is None
    assert usage["model"] == "RecordingModel"
    assert usage["compactions"] == 1


def test_image_token_estimate_uses_deepseek_upper_bound_not_base64_length():
    from agent_playground.context import estimate_tokens

    text = HumanMessage(content=[{"type": "text", "text": "Read this image."}])
    image = HumanMessage(
        content=[
            {"type": "text", "text": "Read this image."},
            {
                "type": "image_url",
                "image_url": {"url": "data:image/png;base64," + "A" * 100000},
            },
        ]
    )

    assert estimate_tokens([image]) - estimate_tokens([text]) == 1024


def test_token_estimate_counts_replayed_reasoning_without_changing_visible_content():
    from agent_playground.context import estimate_tokens

    plain = AIMessage(content="Use the clock tool.")
    reasoning = "Inspect the timestamp. " * 200
    thinking = plain.model_copy(
        update={"additional_kwargs": {"reasoning_content": reasoning}}
    )

    assert estimate_tokens([thinking]) - estimate_tokens([plain]) >= len(reasoning) // 2
    assert thinking.content == plain.content


class RecordingModel(FakeMessagesListChatModel):
    _inputs: list[list[BaseMessage]] = PrivateAttr(default_factory=list)

    @override
    def bind_tools(self, tools: Sequence[object], **kwargs: object):
        return self

    @override
    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: Any = None,
        **kwargs: Any,
    ) -> ChatResult:
        self._inputs.append(messages)

        return super()._generate(messages, stop=stop, run_manager=run_manager, **kwargs)

    @override
    async def _agenerate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: AsyncCallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        return self._generate(messages, stop=stop, run_manager=run_manager, **kwargs)


@pytest.mark.parametrize("asynchronous", [False, True])
def test_image_pixels_survive_checkpoint_and_followup(asynchronous: bool):
    image_content: list[str | dict[str, Any]] = [
        {"type": "text", "text": "Describe this image."},
        {"type": "image_url", "image_url": {"url": "data:image/png;base64,cGl4ZWxz"}},
    ]
    model = RecordingModel(responses=[AIMessage(content="A red square.")])
    saver = InMemorySaver()
    config = {"configurable": {"thread_id": "image-history"}}
    graph = make_graph(model=model, checkpointer=saver)
    inputs = {"messages": [HumanMessage(content=image_content)]}

    if asynchronous:
        asyncio.run(graph.ainvoke(inputs, config))
    else:
        graph.invoke(inputs, config)

    recreated = make_graph(model=model, checkpointer=saver)
    followup = {"messages": [HumanMessage(content="What color was the square?")]}

    if asynchronous:
        asyncio.run(recreated.ainvoke(followup, config))
    else:
        recreated.invoke(followup, config)

    humans = [
        message for message in model._inputs[-1] if isinstance(message, HumanMessage)
    ]
    assert humans[0].content == image_content
    assert humans[-1].content == "What color was the square?"


@pytest.mark.parametrize("asynchronous", [False, True])
def test_compaction_keeps_early_facts_and_survives_graph_recreation(
    model_config: ModelConfigFile, asynchronous: bool
):
    model_config.chat(max_input_tokens=20000)
    model_config.settings["chat"]["compact_ratio"] = 0.5
    model_config.save()
    summary_model = RecordingModel(
        responses=[AIMessage(content="Remember project Cedar.")]
    )
    model = RecordingModel(
        responses=[
            AIMessage(content="Continuing Cedar."),
            AIMessage(content="Project Cedar."),
        ]
    )
    saver = InMemorySaver()
    config = {"configurable": {"thread_id": "compaction"}}
    graph = make_graph(model=model, summary_model=summary_model, checkpointer=saver)
    inputs = {
        "messages": [
            HumanMessage(content="EARLIEST FACT: project Cedar. " + "history " * 3500),
            AIMessage(content="Old response."),
            HumanMessage(content="LATEST REQUEST: continue the project."),
        ]
    }

    if asynchronous:
        result = asyncio.run(graph.ainvoke(inputs, config))
    else:
        result = graph.invoke(inputs, config)

    assert "EARLIEST FACT" in str(summary_model._inputs[0][0].content)
    assert "EARLIEST FACT" not in str(model._inputs[0])
    assert "LATEST REQUEST" in str(model._inputs[0])
    assert result["context_usage"]["compactions"] == 1
    assert result["context_usage"]["breakdown"]["summary"] > 0
    assert result["context_usage"]["usedTokens"] < 10000

    recreated = make_graph(model=model, summary_model=summary_model, checkpointer=saver)
    followup = recreated.invoke(
        {"messages": [HumanMessage(content="What is our project called?")]}, config
    )

    assert "Remember project Cedar" in str(model._inputs[-1])
    assert followup["context_usage"]["compactions"] == 1
    assert len(recreated.get_state(config).values["response_messages"]) == 1


def test_usage_includes_fixed_context_tools_and_provider_input_tokens():
    model = RecordingModel(
        responses=[
            AIMessage(
                content="Done.",
                usage_metadata={
                    "input_tokens": 1500,
                    "output_tokens": 5,
                    "total_tokens": 1505,
                },
            )
        ]
    )
    graph = make_graph(model=model, checkpointer=InMemorySaver())
    config = {"configurable": {"thread_id": "usage"}}
    result = graph.invoke(
        {
            "messages": [
                HumanMessage(content="What time is it?"),
                AIMessage(
                    content="",
                    tool_calls=[
                        {"id": "clock", "name": "get_current_time", "args": {}}
                    ],
                ),
                ToolMessage(content="2026-09-28T00:00:00Z", tool_call_id="clock"),
                HumanMessage(content="Thanks."),
            ]
        },
        config,
    )
    usage = result["context_usage"]

    assert usage["breakdown"]["system"] > 0
    assert usage["breakdown"]["tools"] > 0
    assert usage["breakdown"]["conversation"] > 0
    assert usage["breakdown"]["toolResults"] > 0
    assert usage["usedTokens"] == sum(usage["breakdown"].values())
    assert usage["lastInputTokens"] == 1500
    assert usage["compactions"] == 0
    assert graph.get_state(config).values["response_messages"][0].content == "Done."


def test_a_single_oversized_request_fails_without_silently_dropping_it(
    model_config: ModelConfigFile,
):
    model_config.chat(max_input_tokens=10000)
    model = RecordingModel(responses=[AIMessage(content="Should not be called.")])
    graph = make_graph(model=model)

    with pytest.raises(ValueError, match="context window"):
        graph.invoke({"messages": [HumanMessage(content="oversized " * 10000)]})

    assert not model._inputs


@pytest.mark.parametrize("asynchronous", [False, True])
def test_public_tool_messages_survive_compaction_within_a_turn(
    model_config: ModelConfigFile, asynchronous: bool
):
    model_config.chat(max_input_tokens=20000)
    model_config.settings["chat"]["compact_ratio"] = 0.5
    model_config.save()

    @tool
    def lookup_fact() -> str:
        """Return a known fact for the test."""
        return "Project Cedar launched in 2024."

    model = RecordingModel(
        responses=[
            AIMessage(
                id="lookup-note",
                content="I'll look up the project.",
                tool_calls=[{"id": "lookup", "name": "lookup_fact", "args": {}}],
            ),
            AIMessage(
                id="clock-note",
                content="Now check the date. " + "history " * 3500,
                tool_calls=[{"id": "clock", "name": "get_current_time", "args": {}}],
            ),
            AIMessage(id="answer", content="Cedar launched in 2024."),
        ]
    )
    summary = RecordingModel(responses=[AIMessage(content="Cedar launched in 2024.")])
    graph = make_graph(
        model=model,
        summary_model=summary,
        mcp_tools=[lookup_fact],
        checkpointer=InMemorySaver(),
    )
    config = {"configurable": {"thread_id": "tool-compaction"}}
    inputs = {"messages": [HumanMessage(content="Check the project and the date.")]}

    if asynchronous:
        result = asyncio.run(graph.ainvoke(inputs, config))
    else:
        result = graph.invoke(inputs, config)

    assert result["context_usage"]["compactions"] > 0
    replies = graph.get_state(config).values["response_messages"]
    assert [message.type for message in replies] == ["ai", "tool", "ai", "tool", "ai"]
    assert replies[1].tool_call_id == "lookup"
    assert replies[1].content == "Project Cedar launched in 2024."
    assert replies[0].content == "I'll look up the project."
    assert replies[-1].content == "Cedar launched in 2024."
