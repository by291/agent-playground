"""SQL workflow steps and their checkpointed transitions."""

from hashlib import sha256
from typing import Any

from langgraph.config import get_config
from langgraph.graph import END, START, StateGraph
from langgraph.types import Checkpointer, interrupt

from agent_playground.workflows.sql.api import SqlApi
from agent_playground.workflows.sql.cards import publish_sql_card
from agent_playground.workflows.sql.models import (
    RevisionAgent,
    SqlReviewResponse,
    SqlState,
)


def make_sql_workflow(
    revise: RevisionAgent,
    api: SqlApi,
    checkpointer: Checkpointer | None = None,
):
    async def fetch(state: SqlState) -> dict[str, Any]:
        source = await api.fetch(state.task)

        return {
            "sql": source.sql,
            "original_sql": source.sql,
            "dialect": source.dialect,
            "schema_text": source.schema_text,
        }

    async def check(state: SqlState) -> dict[str, Any]:
        return {"check": await api.check(state.sql), "checked_revision": state.revision}

    async def revise_sql(state: SqlState) -> dict[str, Any]:
        result = await revise(state)
        sql = result.sql.strip() if result.sql is not None else state.sql

        if not sql:
            raise ValueError("The SQL agent returned an empty SQL")

        changed = sql != state.sql
        dialogue = [*state.dialogue]

        if state.feedback:
            dialogue.append({"role": "user", "content": state.feedback})

        dialogue.append({"role": "assistant", "content": result.reply})

        return {
            "sql": sql,
            "revision": state.revision + int(changed),
            "dialogue": dialogue,
            "reply": result.reply,
        }

    async def publish(state: SqlState) -> dict[str, Any]:
        reply = state.reply

        if not reply:
            if state.status == "submitted":
                reply = "The demo API recorded the accepted SQL without executing it."
            elif state.status == "abandoned":
                reply = "The SQL workflow was abandoned. Nothing was submitted."
            else:
                reply = "Review this SQL, ask for changes, or abandon it."

        published = state.model_copy(update={"round": state.round + 1, "reply": reply})
        await publish_sql_card(state=published)

        return {"round": published.round, "reply": reply}

    def wait_for_user(state: SqlState) -> dict[str, Any]:
        response = SqlReviewResponse.model_validate(
            interrupt(
                {
                    "kind": "sql_review",
                    "workflowCallId": state.workflow_call_id,
                    "revision": state.revision,
                    "round": state.round,
                    "outputStepId": f"review:{state.round}",
                    "sql": state.sql,
                    "originalSql": state.original_sql,
                    "check": state.check.model_dump() if state.check else None,
                },
                response_schema=SqlReviewResponse,
            )
        )
        current = (
            response.workflow_call_id == state.workflow_call_id
            and response.revision == state.revision
            and response.round == state.round
        )

        if not current:
            raise ValueError("SQL review is no longer current")

        if response.action == "accept" and (
            state.check is None
            or not state.check.passed
            or state.checked_revision != state.revision
        ):
            raise ValueError("SQL must pass its current check before acceptance")

        if response.action == "message" and not (response.message or "").strip():
            raise ValueError("SQL feedback requires a message")

        return {
            "action": response.action,
            "feedback": (response.message or "").strip(),
            "reply": "",
        }

    async def submit(state: SqlState) -> dict[str, Any]:
        thread_id = (get_config().get("configurable") or {}).get("thread_id")

        if not isinstance(thread_id, str):
            raise TypeError("SQL submission requires a conversation ID")

        identity = f"{thread_id}:{state.workflow_call_id}:{state.revision}"
        key = f"sql-{sha256(identity.encode()).hexdigest()}"
        receipt = await api.submit(state.sql, key)

        return {"submission": receipt, "status": "submitted", "reply": ""}

    def abandon(state: SqlState) -> dict[str, Any]:
        return {"status": "abandoned", "reply": ""}

    def after_initial_check(state: SqlState) -> str:
        return "publish" if state.check and state.check.passed else "revise"

    def after_revision(state: SqlState) -> str:
        return "check" if state.checked_revision != state.revision else "publish"

    def after_publication(state: SqlState) -> str:
        return "wait" if state.status == "review" else END

    def after_decision(state: SqlState) -> str:
        if state.action is None:
            raise ValueError("SQL workflow is missing a user decision")

        return {"message": "revise", "accept": "submit", "abandon": "abandon"}[
            state.action
        ]

    builder = StateGraph(SqlState)
    builder.add_node("fetch", fetch)
    builder.add_node("initial_check", check)
    builder.add_node("revise", revise_sql)
    builder.add_node("check", check)
    builder.add_node("publish", publish)
    builder.add_node("wait", wait_for_user)
    builder.add_node("submit", submit)
    builder.add_node("abandon", abandon)
    builder.add_edge(START, "fetch")
    builder.add_edge("fetch", "initial_check")
    builder.add_conditional_edges("initial_check", after_initial_check)
    builder.add_conditional_edges("revise", after_revision)
    builder.add_edge("check", "publish")
    builder.add_conditional_edges("publish", after_publication)
    builder.add_conditional_edges("wait", after_decision)
    builder.add_edge("submit", "publish")
    builder.add_edge("abandon", "publish")

    return builder.compile(checkpointer=checkpointer)
