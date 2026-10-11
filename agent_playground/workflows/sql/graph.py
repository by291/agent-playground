"""SQL workflow steps and their checkpointed transitions."""

from hashlib import sha256
from typing import Any

from langgraph.config import get_config
from langgraph.graph import END, START, StateGraph
from langgraph.types import Checkpointer

from agent_playground.workflows.review import WorkflowReview, wait_for_review
from agent_playground.workflows.sql.api import SqlApi
from agent_playground.workflows.sql.cards import publish_sql_card
from agent_playground.workflows.sql.models import (
    RevisionAgent,
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
        check_result = await api.check(state.sql)

        return {"check": check_result, "checked_revision": state.revision}

    async def revise_sql(state: SqlState) -> dict[str, Any]:
        result = await revise(state)
        sql = result.sql.strip() if result.sql is not None else state.sql

        if not sql:
            raise ValueError("The SQL agent returned an empty SQL")

        sql_changed = sql != state.sql
        dialogue = [*state.dialogue]

        if state.feedback:
            dialogue.append({"role": "user", "content": state.feedback})

        dialogue.append({"role": "assistant", "content": result.reply})

        return {
            "sql": sql,
            "revision": state.revision + int(sql_changed),
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
        # Explanations keep the existing revision and check. Acceptance must
        # still target the exact SQL revision that produced that check.
        can_accept = (
            state.check is not None
            and state.check.passed
            and state.checked_revision == state.revision
        )
        response = wait_for_review(
            WorkflowReview(
                workflow_call_id=state.workflow_call_id,
                revision=state.revision,
                round=state.round,
                output_step_id=f"review:{state.round}",
                can_accept=can_accept,
                title="SQL decision",
                accept_label="Accept and submit",
                message_placeholder="Ask about this SQL or describe a change…",
                blocked_reason="SQL must pass its current check before submission.",
            )
        )

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

        # A resumed node can retry a committed submission. Its identity includes
        # the conversation and accepted revision so retries reuse one receipt.
        receipt = await api.submit(state.sql, key)

        return {"submission": receipt, "status": "submitted", "reply": ""}

    def abandon(state: SqlState) -> dict[str, Any]:
        return {"status": "abandoned", "reply": ""}

    def after_initial_check(state: SqlState) -> str:
        check_passed = state.check is not None and state.check.passed

        return "publish" if check_passed else "revise"

    def after_revision(state: SqlState) -> str:
        # A conversational explanation has no new SQL to validate.
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
