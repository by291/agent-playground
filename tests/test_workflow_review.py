"""Verify the reusable review boundary with a non-SQL business workflow."""

import asyncio
from typing import Any

import pytest
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command
from pydantic import BaseModel

from agent_playground.workflows.review import WorkflowReview, wait_for_review


class CopyState(BaseModel):
    title: str
    accepted: bool = False
    feedback: str = ""


@pytest.mark.parametrize(
    ("response", "error"),
    [
        ({"action": "accept"}, "Resolve the factual issue first"),
        ({"action": "message", "message": "   "}, "requires a message"),
        ({"action": "abandon", "revision": 1}, "no longer current"),
        ({"action": "abandon"}, None),
        ({"action": "message", "message": "Explain"}, None),
    ],
)
def test_copy_review_enforces_identity_and_acceptance_without_sql(
    response: dict[str, Any], error: str | None
):
    async def run():
        def review(state: CopyState) -> dict[str, object]:
            answer = wait_for_review(
                WorkflowReview(
                    workflow_call_id="copy-call",
                    revision=4,
                    round=2,
                    output_step_id="review:2",
                    can_accept=False,
                    title="Copy decision",
                    blocked_reason="Resolve the factual issue first.",
                )
            )

            return {
                "accepted": answer.action == "accept",
                "feedback": answer.message or "",
            }

        builder = StateGraph(CopyState)
        builder.add_node("review", review)
        builder.add_edge(START, "review")
        builder.add_edge("review", END)
        graph = builder.compile(checkpointer=InMemorySaver())
        config = {"configurable": {"thread_id": "copy-review"}}
        paused = await graph.ainvoke(CopyState(title="Draft copy"), config)
        value = paused["__interrupt__"][0].value

        assert value["kind"] == "workflow_review"
        command = Command(
            resume={
                "workflowCallId": "copy-call",
                "revision": 4,
                "round": 2,
                **response,
            }
        )

        if error:
            with pytest.raises(ValueError, match=error):
                await graph.ainvoke(command, config)
        else:
            result = await graph.ainvoke(command, config)
            assert not result["accepted"]
            assert result["feedback"] == response.get("message", "")

    asyncio.run(run())
