"""Keep workflow card payloads compatible with the renderer's v0.9 protocol."""

import pytest

from agent_playground.services.sql.models import SqlCheck, SqlSubmission
from agent_playground.workflows.a2a.cards import completion_receipt
from agent_playground.workflows.cards import content_card
from agent_playground.workflows.sql.cards import sql_card
from agent_playground.workflows.sql.models import SqlState


def test_content_card_preserves_component_order_and_child_references():
    card = content_card(
        surface_id="experiment-call-review",
        title="Draft ready",
        heading="REVIEW",
        lines=["Check the draft.", "Accept or revise."],
    ).model_dump(mode="json", by_alias=True, exclude_none=True)

    assert card["messages"][0] == {
        "version": "v0.9",
        "createSurface": {
            "surfaceId": "experiment-call-review",
            "catalogId": "urn:agent-playground:workflow:v1",
        },
    }
    assert card["messages"][1] == {
        "version": "v0.9",
        "updateComponents": {
            "surfaceId": "experiment-call-review",
            "components": [
                {
                    "id": "root",
                    "component": "WorkflowPanel",
                    "children": ["eyebrow", "title", "steps"],
                },
                {
                    "id": "eyebrow",
                    "component": "WorkflowText",
                    "text": "REVIEW",
                    "role": "eyebrow",
                },
                {
                    "id": "title",
                    "component": "WorkflowText",
                    "text": "Draft ready",
                    "role": "title",
                },
                {
                    "id": "steps",
                    "component": "WorkflowSteps",
                    "children": ["step-0", "step-1"],
                },
                {
                    "id": "step-0",
                    "component": "WorkflowText",
                    "text": "Check the draft.",
                    "role": "step",
                },
                {
                    "id": "step-1",
                    "component": "WorkflowText",
                    "text": "Accept or revise.",
                    "role": "step",
                },
            ],
        },
    }


def test_completion_receipt_keeps_the_summary_in_a_body_component():
    card = completion_receipt(
        "a2a-call-result", "Completed", "Open the child output."
    ).model_dump(mode="json", by_alias=True, exclude_none=True)
    update = card["messages"][1]["updateComponents"]

    assert update["surfaceId"] == "a2a-call-result"
    assert update["components"][0] == {
        "id": "root",
        "component": "WorkflowPanel",
        "children": ["eyebrow", "title", "body"],
    }
    assert update["components"][3] == {
        "id": "body",
        "component": "WorkflowText",
        "text": "Open the child output.",
        "role": "body",
    }


@pytest.mark.parametrize("submitted", [False, True])
def test_sql_card_preserves_review_state_and_optional_receipt(submitted: bool):
    state = SqlState(
        task="Show orders",
        workflow_call_id="call",
        original_sql="SELECT * FROM orders",
        sql="SELECT id FROM orders",
        revision=2,
        round=3,
        status="submitted" if submitted else "review",
        check=SqlCheck(passed=True, issues=[]),
        submission=(
            SqlSubmission(
                id="receipt-1", sql="SELECT id FROM orders", status="submitted"
            )
            if submitted
            else None
        ),
    )
    card = sql_card(state).model_dump(mode="json", by_alias=True, exclude_none=True)
    update = card["messages"][1]["updateComponents"]
    expected: dict[str, object] = {
        "id": "root",
        "component": "WorkflowSql",
        "workflowCallId": "call",
        "sql": "SELECT id FROM orders",
        "originalSql": "SELECT * FROM orders",
        "revision": 2,
        "round": 3,
        "status": "submitted" if submitted else "review",
        "check": {"passed": True, "issues": []},
    }

    if submitted:
        expected["receiptId"] = "receipt-1"

    assert update == {"surfaceId": "sql-call-3", "components": [expected]}
