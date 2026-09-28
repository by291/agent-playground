"""Check the graph without calling a real model provider."""

import asyncio
import os
from collections.abc import Sequence
from typing import Any, cast, override
from uuid import uuid4

import pytest
from langchain_core.callbacks.manager import AsyncCallbackManagerForLLMRun
from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage
from langchain_core.outputs import ChatResult
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command
from pydantic import BaseModel
from testcontainers.community.postgres import PostgresContainer

os.environ.setdefault("DEEPSEEK_API_KEY", "test")

from agent_playground.graph import make_graph, mcp_client
from agent_playground.workflow import ExperimentState, experiment_workflow
from agent_playground.workflow_outputs import WorkflowOutput


@pytest.fixture(autouse=True)
def isolate_workflow_output_store(monkeypatch: pytest.MonkeyPatch):
    async def save_card(
        thread_id: str,
        agui_run_id: str,
        workflow_call_id: str,
        step_id: str,
        step_seq: int,
        payload: dict[str, object],
    ) -> WorkflowOutput:
        return WorkflowOutput(
            id=f"experiment-{workflow_call_id}-{step_id}",
            agui_run_id=agui_run_id,
            output_seq=step_seq,
            payload=payload,
        )

    monkeypatch.setattr("agent_playground.workflow.store_workflow_output", save_card)


class FakeToolModel(FakeMessagesListChatModel):
    @override
    def bind_tools(self, tools: Sequence[object], **kwargs: object):
        return self

    @override
    async def _agenerate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: AsyncCallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        return self._generate(messages, stop=stop, **kwargs)


class ReviewState(BaseModel):
    idea: str
    result: dict[str, object] | None = None


def fake_model() -> FakeToolModel:
    return FakeToolModel(
        responses=[
            AIMessage(
                content="",
                tool_calls=[{"id": "call-1", "name": "get_current_time", "args": {}}],
            ),
            AIMessage(content="The clock was checked."),
        ]
    )


def test_tool_and_followup_response():
    graph = make_graph(model=fake_model())
    output = graph.invoke({"messages": [HumanMessage(content="What time is it?")]})
    assert output["messages"][-1].content == "The clock was checked."
    assert output["messages"][-2].name == "get_current_time"


def test_mcp_tool_and_followup_response():
    async def check():
        mcp_tools = await mcp_client().get_tools()
        assert [tool.name for tool in mcp_tools] == ["calculate_sum"]

        model = FakeToolModel(
            responses=[
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "id": "call-sum",
                            "name": "calculate_sum",
                            "args": {"left": 2, "right": 3},
                        },
                    ],
                ),
                AIMessage(content="The sum is ready."),
            ]
        )
        output = await make_graph(model=model, mcp_tools=mcp_tools).ainvoke(
            {"messages": [HumanMessage(content="Add two numbers.")]}
        )
        results = {message.name: message.content for message in output["messages"]}
        assert "5.0" in str(results["calculate_sum"])
        assert output["messages"][-1].content == "The sum is ready."

    asyncio.run(check())


@pytest.mark.parametrize(
    ("decision", "expected_title", "expected_line"),
    [
        ("approve", "Human-approved title", "1. Run an edited first step."),
        ("reject", "Test an agent workflow", "1. The reviewer rejected this draft."),
    ],
)
def test_workflow_streams_each_step_and_waits_for_review(
    decision: str, expected_title: str, expected_line: str
):
    async def call_workflow(state: ReviewState) -> dict[str, dict[str, object]]:
        result = await experiment_workflow.ainvoke(
            ExperimentState(idea=state.idea, card_group_id="call-plan")
        )
        return {"result": result}

    builder = StateGraph(ReviewState)
    builder.add_node("workflow", call_workflow)
    builder.add_edge(START, "workflow")
    builder.add_edge("workflow", END)
    graph = builder.compile(checkpointer=InMemorySaver())
    config = {
        "configurable": {"thread_id": str(uuid4())},
        "metadata": {"agui_run_id": "agui-test"},
    }

    async def cards_for(input_value: object) -> list[dict[str, Any]]:
        cards: list[dict[str, Any]] = []
        async for event in graph.astream_events(input_value, config, version="v2"):
            if event["event"] == "on_custom_event" and event["name"] == "a2ui":
                cards.append(cast("dict[str, Any]", event["data"]))
        return cards

    async def check():
        before = await cards_for({"idea": "Test an agent workflow"})
        assert [card["id"] for card in before] == [
            "experiment-call-plan-idea",
            "experiment-call-plan-draft",
            "experiment-call-plan-review",
        ]
        assert all("kind" not in card and "messages" in card for card in before)
        review = graph.get_state(config).tasks[0].interrupts[0].value
        assert review["kind"] == "experiment_plan_review"
        assert review["title"] == "Test an agent workflow"
        assert len(review["steps"]) == 3

        after = await cards_for(
            Command(
                resume={
                    "decision": decision,
                    "title": "Human-approved title",
                    "steps": ["Run an edited first step."],
                }
            )
        )
        assert after[-1]["id"] == "experiment-call-plan-reviewed"
        components = after[-1]["messages"][1]["updateComponents"]["components"]
        assert any(component.get("text") == expected_title for component in components)
        assert any(
            component.get("text") == expected_line.removeprefix("1. ")
            for component in components
        )
        assert graph.get_state(config).next == ()

    asyncio.run(check())


def test_agent_resumes_workflow_tool_after_review():
    async def check():
        first_model = FakeToolModel(
            responses=[
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "id": "call-plan",
                            "name": "run_experiment_workflow",
                            "args": {"idea": "Test an agent workflow"},
                        }
                    ],
                ),
            ]
        )
        saver = InMemorySaver()
        first_graph = make_graph(model=first_model, checkpointer=saver)
        config = {
            "configurable": {"thread_id": str(uuid4())},
            "metadata": {"agui_run_id": "agui-test"},
        }

        cards: list[dict[str, Any]] = []
        async for event in first_graph.astream_events(
            {"messages": [HumanMessage(content="Make a plan.")]},
            config,
            version="v2",
        ):
            if event["event"] == "on_custom_event" and event["name"] == "a2ui":
                cards.append(cast("dict[str, Any]", event["data"]))
        assert [card["id"] for card in cards] == [
            "experiment-call-plan-idea",
            "experiment-call-plan-draft",
            "experiment-call-plan-review",
        ]
        assert (
            first_graph.get_state(config).tasks[0].interrupts[0].value["kind"]
            == "experiment_plan_review"
        )

        resumed_graph = make_graph(
            model=FakeToolModel(
                responses=[AIMessage(content="The approved plan is ready.")]
            ),
            checkpointer=saver,
        )
        completed = await resumed_graph.ainvoke(
            Command(
                resume={
                    "decision": "approve",
                    "title": "Approved title",
                    "steps": ["Run one trial."],
                }
            ),
            config,
        )
        result = next(
            message.content
            for message in completed["messages"]
            if getattr(message, "name", None) == "run_experiment_workflow"
        )
        assert result == "Approved experiment plan: Approved title\n1. Run one trial."
        assert completed["messages"][-1].content == "The approved plan is ready."

    asyncio.run(check())


def test_agent_resumes_parallel_workflow_reviews():
    async def check():
        model = FakeToolModel(
            responses=[
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "id": "call-first",
                            "name": "run_experiment_workflow",
                            "args": {"idea": "First idea"},
                        },
                        {
                            "id": "call-second",
                            "name": "run_experiment_workflow",
                            "args": {"idea": "Second idea"},
                        },
                    ],
                ),
                AIMessage(content="Both reviews are complete."),
            ]
        )
        graph = make_graph(model=model, checkpointer=InMemorySaver())
        config = {
            "configurable": {"thread_id": str(uuid4())},
            "metadata": {"agui_run_id": "agui-test"},
        }

        paused = await graph.ainvoke(
            {"messages": [HumanMessage(content="Plan both ideas.")]}, config
        )
        interrupts = paused["__interrupt__"]
        assert len(interrupts) == 2

        completed = await graph.ainvoke(
            Command(
                resume={
                    item.id: {
                        "decision": "approve",
                        "title": item.value["title"],
                        "steps": item.value["steps"],
                    }
                    for item in interrupts
                }
            ),
            config,
        )
        results = {
            message.tool_call_id: message.content
            for message in completed["messages"]
            if getattr(message, "name", None) == "run_experiment_workflow"
        }
        assert "Approved experiment plan: First idea" in results["call-first"]
        assert "Approved experiment plan: Second idea" in results["call-second"]
        assert completed["messages"][-1].content == "Both reviews are complete."

    asyncio.run(check())


def test_postgres_checkpoint_survives_graph_recreation():
    async def check(database_url: str):
        thread_id = str(uuid4())
        async with AsyncPostgresSaver.from_conn_string(database_url) as first_saver:
            await first_saver.setup()
            first_graph = make_graph(
                model=FakeToolModel(responses=[AIMessage(content="First answer")]),
                checkpointer=first_saver,
            )
            await first_graph.ainvoke(
                {"messages": [HumanMessage(content="First turn")]},
                {"configurable": {"thread_id": thread_id}},
            )

        async with AsyncPostgresSaver.from_conn_string(database_url) as second_saver:
            second_graph = make_graph(
                model=FakeToolModel(responses=[AIMessage(content="Second answer")]),
                checkpointer=second_saver,
            )
            result = await second_graph.ainvoke(
                {"messages": [HumanMessage(content="Second turn")]},
                {"configurable": {"thread_id": thread_id}},
            )

        user_turns = [
            message.content
            for message in result["messages"]
            if isinstance(message, HumanMessage)
        ]
        assert user_turns == ["First turn", "Second turn"]

    with PostgresContainer("postgres:18-alpine") as postgres:
        asyncio.run(check(postgres.get_connection_url(driver=None)))
