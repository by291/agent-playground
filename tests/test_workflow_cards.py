"""Check the custom A2UI catalog used by workflow output."""

from agent_playground.workflow_cards import experiment_card


def test_workflow_output_uses_the_official_message_wrapper():
    card = experiment_card(
        workflow_call_id="call",
        title="Demo",
        stage="idea",
        heading="IDEA",
        lines=["Try it"],
    )
    payload = card.model_dump(mode="json", by_alias=True, exclude_none=True)

    assert set(payload) == {"messages"}


def test_experiment_card_uses_playground_components():
    card = experiment_card(
        workflow_call_id="call-1",
        title="Demo",
        stage="draft",
        heading="DRAFT PLAN",
        lines=["Try it"],
    )
    messages = card.model_dump(mode="json", by_alias=True, exclude_none=True)[
        "messages"
    ]

    assert messages[0]["createSurface"]["catalogId"] == (
        "urn:agent-playground:workflow:v1"
    )
    components = messages[1]["updateComponents"]["components"]

    assert [component["component"] for component in components[:4]] == [
        "WorkflowPanel",
        "WorkflowText",
        "WorkflowText",
        "WorkflowSteps",
    ]
    assert components[0]["children"] == ["eyebrow", "title", "steps"]
    assert components[3]["children"] == ["step-0"]
    assert components[4]["text"] == "Try it"
