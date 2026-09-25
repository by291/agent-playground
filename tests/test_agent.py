"""Check the graph without calling a real model provider."""

import asyncio
import json
import os
from collections.abc import Sequence
from typing import override
from uuid import uuid4

from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from testcontainers.community.postgres import PostgresContainer

os.environ.setdefault("DEEPSEEK_API_KEY", "test")

from agent_playground.graph import make_graph, mcp_client


class FakeToolModel(FakeMessagesListChatModel):
    @override
    def bind_tools(self, tools: Sequence[object], **kwargs: object):
        return self


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
    async def check():
        graph = make_graph(model=fake_model())
        output = await graph.ainvoke(
            {"messages": [HumanMessage(content="What time is it?")]}
        )
        assert output["messages"][-1].content == "The clock was checked."
        assert output["messages"][-2].name == "get_current_time"

    asyncio.run(check())


def test_mcp_tool_and_workflow_card():
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
                        {
                            "id": "call-plan",
                            "name": "run_experiment_workflow",
                            "args": {"idea": "Test an agent workflow"},
                        },
                    ],
                ),
                AIMessage(content="The experiment plan is ready."),
            ]
        )
        output = await make_graph(model=model, mcp_tools=mcp_tools).ainvoke(
            {"messages": [HumanMessage(content="Add two numbers and make a plan.")]}
        )
        results = {message.name: message.content for message in output["messages"]}
        assert "5.0" in str(results["calculate_sum"])

        card = json.loads(results["run_experiment_workflow"])
        assert card["kind"] == "a2ui"
        assert card["messages"][0]["createSurface"]["catalogId"].endswith(
            "/v0_9/catalogs/basic/catalog.json"
        )
        assert (
            card["messages"][1]["updateComponents"]["components"][0]["component"]
            == "Card"
        )
        assert output["messages"][-1].content == "The experiment plan is ready."

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

    with PostgresContainer("postgres:17-alpine") as postgres:
        asyncio.run(check(postgres.get_connection_url(driver=None)))
