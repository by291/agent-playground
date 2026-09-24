"""Check the graph without calling a real model provider."""

import asyncio
import os
from uuid import uuid4

import pytest
from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

os.environ.setdefault("OPENAI_API_KEY", "test")

from agent_playground.graph import make_graph


class FakeToolModel(FakeMessagesListChatModel):
    def bind_tools(self, tools, **kwargs):
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
        output = await graph.ainvoke({"messages": [HumanMessage(content="What time is it?")]})
        assert output["messages"][-1].content == "The clock was checked."
        assert output["messages"][-2].name == "get_current_time"

    asyncio.run(check())


@pytest.mark.skipif(not os.getenv("TEST_DATABASE_URL"), reason="PostgreSQL test URL not set")
def test_postgres_checkpoint_survives_graph_recreation():
    async def check():
        thread_id = str(uuid4())
        database_url = os.environ["TEST_DATABASE_URL"]
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
            message.content for message in result["messages"] if isinstance(message, HumanMessage)
        ]
        assert user_turns == ["First turn", "Second turn"]

    asyncio.run(check())
