"""Verify SQL workflow pause/revision/accept behavior with a controlled agent."""

import asyncio
from collections.abc import Sequence
from typing import Any, override

import pytest
from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.runnables import RunnableLambda
from langchain_deepseek import ChatDeepSeek
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

from agent_playground.db.workflow_outputs import WorkflowOutput
from agent_playground.graph import make_graph
from agent_playground.services.sql.models import SqlCheck, SqlSource, SqlSubmission
from agent_playground.workflows.sql.agent import sql_revision_model
from agent_playground.workflows.sql.graph import make_sql_workflow
from agent_playground.workflows.sql.models import (
    SqlRevision,
    SqlState,
)


class DemoClient:
    def __init__(self):
        self.fetches = 0
        self.checks: list[str] = []
        self.submissions: list[str] = []

    async def fetch(self, task: str) -> SqlSource:
        self.fetches += 1
        return SqlSource(
            sql="SELECT * FROM orders",
            dialect="postgres",
            schema_text="orders(id, amount)",
        )

    async def check(self, sql: str) -> SqlCheck:
        self.checks.append(sql)
        return SqlCheck(
            passed="*" not in sql,
            issues=[] if "*" not in sql else ["Use explicit columns."],
        )

    async def submit(self, sql: str, key: str) -> SqlSubmission:
        self.submissions.append(sql)
        return SqlSubmission(id=key, sql=sql, status="submitted")


def test_deepseek_revision_model_disables_thinking_for_forced_structured_tools():
    model = ChatDeepSeek(model="deepseek-flash", api_key="test")
    revision = sql_revision_model(model)

    assert isinstance(revision, ChatDeepSeek)
    assert revision.extra_body == {"thinking": {"type": "disabled"}}
    assert model.extra_body is None
    assert revision.metadata is not None
    assert not revision.metadata["emit-messages"]


def test_sql_loop_keeps_explanations_checked_and_submits_the_accepted_revision(
    monkeypatch: pytest.MonkeyPatch,
):
    async def run():
        client = DemoClient()
        outputs: list[dict[str, Any]] = []

        async def publish(**kwargs: Any):
            outputs.append(kwargs)

        async def revise(state: SqlState) -> SqlRevision:
            if state.feedback == "Explain":
                return SqlRevision(reply="The query uses explicit columns.")
            if state.feedback == "Only amounts":
                return SqlRevision(
                    reply="Selected only amounts.", sql="SELECT amount FROM orders"
                )
            return SqlRevision(
                reply="Replaced the wildcard.", sql="SELECT id, amount FROM orders"
            )

        monkeypatch.setattr(
            "agent_playground.workflows.sql.graph.publish_sql_card", publish
        )
        saver = InMemorySaver()
        graph = make_sql_workflow(revise, client, saver)
        config = {"configurable": {"thread_id": "sql-loop"}}
        paused = await graph.ainvoke(
            SqlState(task="Show orders", workflow_call_id="call"), config
        )
        value = paused["__interrupt__"][0].value

        assert value["revision"] == 2
        assert value["canAccept"]
        assert client.fetches == 1
        assert len(client.checks) == 2

        async def resume(action: str, message: str | None = None):
            current = graph.get_state(config).tasks[0].interrupts[0].value
            return await graph.ainvoke(
                Command(
                    resume={
                        "action": action,
                        "workflowCallId": "call",
                        "revision": current["revision"],
                        "round": current["round"],
                        "message": message,
                    }
                ),
                config,
            )

        await resume("message", "Explain")
        assert graph.get_state(config).values["revision"] == 2
        assert len(client.checks) == 2
        await resume("message", "Only amounts")
        assert graph.get_state(config).values["revision"] == 3
        assert len(client.checks) == 3

        graph = make_sql_workflow(revise, client, saver)
        completed = await resume("accept")
        assert completed["status"] == "submitted"
        assert client.submissions == ["SELECT amount FROM orders"]
        assert client.fetches == 1
        assert len({item["state"].round for item in outputs}) == len(outputs)

    asyncio.run(run())


class SqlToolModel(FakeMessagesListChatModel):
    @override
    def bind_tools(self, tools: Sequence[object], **kwargs: Any):
        return self

    @override
    def with_structured_output(self, schema: Any, **kwargs: Any):
        def revision(messages: Any) -> SqlRevision:
            return SqlRevision(
                reply="Selected explicit columns.", sql="SELECT id FROM orders"
            )

        return RunnableLambda(revision)


def test_sql_tool_resumes_after_graph_recreation_without_repeating_fetch(
    monkeypatch: pytest.MonkeyPatch,
):
    async def run():
        client = DemoClient()
        monkeypatch.setattr(
            "agent_playground.workflows.sql.tool.HttpSqlApi", lambda: client
        )

        async def save(**kwargs: Any):
            return WorkflowOutput(
                id=kwargs["step_id"],
                agui_run_id=kwargs["agui_run_id"],
                output_seq=kwargs["step_seq"],
                payload=kwargs["payload"],
            )

        monkeypatch.setattr(
            "agent_playground.workflows.output.store_workflow_output", save
        )
        saver = InMemorySaver()
        graph = make_graph(
            model=SqlToolModel(
                responses=[
                    AIMessage(
                        content="",
                        tool_calls=[
                            {
                                "id": "call-sql",
                                "name": "run_sql_workflow",
                                "args": {"task": "Show orders"},
                            }
                        ],
                    )
                ]
            ),
            checkpointer=saver,
        )
        config = {
            "configurable": {"thread_id": "sql-tool"},
            "metadata": {"agui_run_id": "run"},
        }
        paused = await graph.ainvoke(
            {"messages": [HumanMessage(content="Show SQL")]}, config
        )
        review = paused["__interrupt__"][0]

        assert review.value["revision"] == 2
        graph = make_graph(
            model=SqlToolModel(responses=[AIMessage(content="Recorded the SQL.")]),
            checkpointer=saver,
        )
        completed = await graph.ainvoke(
            Command(
                resume={
                    review.id: {
                        "action": "accept",
                        "workflowCallId": "call-sql",
                        "revision": 2,
                        "round": review.value["round"],
                    }
                }
            ),
            config,
        )

        assert completed["messages"][-1].content == "Recorded the SQL."
        assert client.fetches == 1
        assert client.submissions == ["SELECT id FROM orders"]

    asyncio.run(run())


def test_receipt_identity_includes_the_conversation(monkeypatch: pytest.MonkeyPatch):
    async def run():
        client = DemoClient()

        async def publish(**kwargs: Any):
            pass

        async def revise(state: SqlState) -> SqlRevision:
            return SqlRevision(reply="Selected columns.", sql="SELECT id FROM orders")

        monkeypatch.setattr(
            "agent_playground.workflows.sql.graph.publish_sql_card", publish
        )
        receipts: list[str] = []

        for thread_id in ["conversation-one", "conversation-two"]:
            graph = make_sql_workflow(revise, client, InMemorySaver())
            config = {"configurable": {"thread_id": thread_id}}
            paused = await graph.ainvoke(
                SqlState(task="Orders", workflow_call_id="call_0"), config
            )
            review = paused["__interrupt__"][0].value
            completed = await graph.ainvoke(
                Command(
                    resume={
                        "action": "accept",
                        "workflowCallId": "call_0",
                        "revision": review["revision"],
                        "round": review["round"],
                    }
                ),
                config,
            )
            receipts.append(completed["submission"].id)

        assert len(set(receipts)) == 2

    asyncio.run(run())


def test_failed_checks_and_stale_acceptance_cannot_submit(
    monkeypatch: pytest.MonkeyPatch,
):
    async def run():
        client = DemoClient()

        async def publish(**kwargs: Any):
            pass

        async def revise(state: SqlState) -> SqlRevision:
            return SqlRevision(reply="Please clarify the columns.")

        monkeypatch.setattr(
            "agent_playground.workflows.sql.graph.publish_sql_card", publish
        )
        graph = make_sql_workflow(revise, client, InMemorySaver())
        config = {"configurable": {"thread_id": "failed-sql"}}
        result = await graph.ainvoke(
            SqlState(task="Orders", workflow_call_id="call"), config
        )
        value = result["__interrupt__"][0].value

        for revision in [0, value["revision"]]:
            graph = make_sql_workflow(revise, client, InMemorySaver())
            await graph.ainvoke(
                SqlState(task="Orders", workflow_call_id="call"), config
            )

            with pytest.raises(ValueError):
                await graph.ainvoke(
                    Command(
                        resume={
                            "action": "accept",
                            "workflowCallId": "call",
                            "revision": revision,
                            "round": value["round"],
                        }
                    ),
                    config,
                )

        graph = make_sql_workflow(revise, client, InMemorySaver())
        await graph.ainvoke(SqlState(task="Orders", workflow_call_id="call"), config)
        await graph.ainvoke(
            Command(
                resume={
                    "action": "abandon",
                    "workflowCallId": "call",
                    "revision": value["revision"],
                    "round": value["round"],
                }
            ),
            config,
        )
        assert not client.submissions
        assert graph.get_state(config).values["status"] == "abandoned"

    asyncio.run(run())
