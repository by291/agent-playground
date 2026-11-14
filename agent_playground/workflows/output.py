"""Publish durable A2UI workflow outputs using the current LangGraph runtime."""

from dataclasses import dataclass

from a2ui.core.schema.v0_9 import A2uiMessageListWrapper
from langchain_core.callbacks.manager import adispatch_custom_event
from langgraph.config import get_config
from pydantic import BaseModel, ConfigDict, Field

from agent_playground.db.workflow_outputs import (
    StoreWorkflowOutput,
    store_workflow_output,
)


class WorkflowReply(BaseModel):
    id: str = Field(min_length=1)
    content: str = Field(min_length=1)


class WorkflowPresentation(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    surface_id: str = Field(alias="surfaceId", min_length=1)
    group_id: str = Field(alias="groupId", min_length=1)
    anchor_message_id: str | None = Field(default=None, alias="anchorMessageId")


class WorkflowOutputMetadata(BaseModel):
    reply: WorkflowReply | None = None
    presentation: WorkflowPresentation | None = None


@dataclass(frozen=True)
class PublishWorkflowOutput:
    workflow_call_id: str
    step_id: str
    step_seq: int
    card: A2uiMessageListWrapper
    workflow: WorkflowOutputMetadata | None = None


async def publish_workflow_output(request: PublishWorkflowOutput) -> None:
    """Persist output before publishing an event with its durable identity."""
    config = get_config()
    metadata = config.get("metadata") or {}
    configurable = config.get("configurable") or {}
    agui_run_id = metadata.get("agui_run_id")
    thread_id = configurable.get("thread_id")

    if not isinstance(agui_run_id, str) or not isinstance(thread_id, str):
        raise TypeError("Workflow output is missing AG-UI run or thread ID")

    payload = request.card.model_dump(mode="json", by_alias=True, exclude_none=True)

    if request.workflow is not None:
        payload["workflow"] = request.workflow.model_dump(
            mode="json", by_alias=True, exclude_none=True
        )

    output = await store_workflow_output(
        StoreWorkflowOutput(
            thread_id=thread_id,
            agui_run_id=agui_run_id,
            workflow_call_id=request.workflow_call_id,
            step_id=request.step_id,
            step_seq=request.step_seq,
            payload=payload,
        )
    )

    # Reconnects read the same persisted payload and identity. Emitting before
    # storage completes would expose output that history cannot recover.
    await adispatch_custom_event(
        "a2ui",
        {
            "id": output.id,
            "aguiRunId": output.agui_run_id,
            "workflowCallId": request.workflow_call_id,
            "outputSeq": output.output_seq,
            "toolCallId": request.workflow_call_id,
            **output.payload,
        },
    )
