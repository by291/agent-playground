"""Check durable publication ordering and retry identity at the stream boundary."""

import asyncio

import pytest

from agent_playground.db.workflow_outputs import WorkflowOutput
from agent_playground.workflows.experiment.cards import experiment_card
from agent_playground.workflows.output import (
    WorkflowOutputMetadata,
    WorkflowPresentation,
    WorkflowReply,
    publish_workflow_output,
)


@pytest.mark.parametrize(
    ("store_fails", "with_metadata"), [(False, False), (True, False), (False, True)]
)
def test_publish_waits_for_storage_and_uses_persisted_identity(
    monkeypatch: pytest.MonkeyPatch, store_fails: bool, with_metadata: bool
):
    actions: list[str] = []
    card = experiment_card(
        workflow_call_id="call",
        title="Demo",
        stage="review",
        heading="REVIEW",
        lines=[],
    )
    payload = card.model_dump(mode="json", by_alias=True, exclude_none=True)
    metadata = None

    if with_metadata:
        metadata = WorkflowOutputMetadata(
            reply=WorkflowReply(id="reply", content="The draft is ready."),
            presentation=WorkflowPresentation(
                surface_id="experiment-call-review",
                group_id="draft",
                anchor_message_id="reply",
            ),
        )
        payload["workflow"] = {
            "reply": {"id": "reply", "content": "The draft is ready."},
            "presentation": {
                "surfaceId": "experiment-call-review",
                "groupId": "draft",
                "anchorMessageId": "reply",
            },
        }

    async def store(
        *,
        thread_id: str,
        agui_run_id: str,
        workflow_call_id: str,
        step_id: str,
        step_seq: int,
        payload: dict[str, object],
    ) -> WorkflowOutput:
        assert thread_id == "thread"
        assert agui_run_id == "resumed-run"
        assert workflow_call_id == "call"
        assert (step_id, step_seq) == ("review", 3)
        assert ("workflow" in payload) == with_metadata
        actions.append("persist")

        if store_fails:
            raise ValueError("storage failed")

        return WorkflowOutput("original-output", "original-run", 7, payload)

    async def dispatch(name: str, event: dict[str, object]) -> None:
        assert actions == ["persist"]
        assert name == "a2ui"
        assert event == {
            "id": "original-output",
            "aguiRunId": "original-run",
            "workflowCallId": "call",
            "outputSeq": 7,
            "toolCallId": "call",
            **payload,
        }
        actions.append("dispatch")

    monkeypatch.setattr(
        "agent_playground.workflows.output.get_config",
        lambda: {
            "metadata": {"agui_run_id": "resumed-run"},
            "configurable": {"thread_id": "thread"},
        },
    )
    monkeypatch.setattr(
        "agent_playground.workflows.output.store_workflow_output", store
    )
    monkeypatch.setattr(
        "agent_playground.workflows.output.adispatch_custom_event", dispatch
    )

    async def check():
        if store_fails:
            with pytest.raises(ValueError, match="storage failed"):
                await publish_workflow_output(
                    workflow_call_id="call",
                    step_id="review",
                    step_seq=3,
                    card=card,
                    workflow=metadata,
                )
        else:
            await publish_workflow_output(
                workflow_call_id="call",
                step_id="review",
                step_seq=3,
                card=card,
                workflow=metadata,
            )

    asyncio.run(check())
    assert actions == (["persist"] if store_fails else ["persist", "dispatch"])
