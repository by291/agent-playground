"""Check durable publication ordering and retry identity at the stream boundary."""

import asyncio

import pytest

from agent_playground.db.workflow_outputs import StoreWorkflowOutput, WorkflowOutput
from agent_playground.workflows.experiment.cards import ExperimentCard, experiment_card
from agent_playground.workflows.output import (
    PublishWorkflowOutput,
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
        ExperimentCard(
            workflow_call_id="call",
            title="Demo",
            stage="review",
            heading="REVIEW",
            lines=[],
        )
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

    async def store(request: StoreWorkflowOutput) -> WorkflowOutput:
        assert request.thread_id == "thread"
        assert request.agui_run_id == "resumed-run"
        assert request.workflow_call_id == "call"
        assert (request.step_id, request.step_seq) == ("review", 3)
        assert ("workflow" in request.payload) == with_metadata
        actions.append("persist")

        if store_fails:
            raise ValueError("storage failed")

        return WorkflowOutput(
            id="original-output",
            agui_run_id="original-run",
            output_seq=7,
            payload=request.payload,
        )

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
        request = PublishWorkflowOutput(
            workflow_call_id="call",
            step_id="review",
            step_seq=3,
            card=card,
            workflow=metadata,
        )

        if store_fails:
            with pytest.raises(ValueError, match="storage failed"):
                await publish_workflow_output(request)
        else:
            await publish_workflow_output(request)

    asyncio.run(check())
    assert actions == (["persist"] if store_fails else ["persist", "dispatch"])
