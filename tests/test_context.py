"""Exercise context compaction and reporting without an external model."""

import asyncio
from collections.abc import Sequence
from typing import Any, override

import pytest
from langchain_core.callbacks.manager import AsyncCallbackManagerForLLMRun
from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolMessage
from langchain_core.outputs import ChatResult
from langgraph.checkpoint.memory import InMemorySaver
from pydantic import PrivateAttr

from agent_playground.graph import make_graph


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
def test_compaction_keeps_early_facts_and_survives_graph_recreation(
    monkeypatch: pytest.MonkeyPatch, asynchronous: bool
):
    monkeypatch.setenv("CONTEXT_WINDOW_TOKENS", "20000")
    monkeypatch.setenv("CONTEXT_COMPACT_RATIO", "0.5")
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
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv("CONTEXT_WINDOW_TOKENS", "1000")
    model = RecordingModel(responses=[AIMessage(content="Should not be called.")])
    graph = make_graph(model=model)

    with pytest.raises(ValueError, match="context window"):
        graph.invoke({"messages": [HumanMessage(content="oversized " * 1000)]})

    assert not model._inputs
