"""Publish durable A2UI workflow outputs using the current LangGraph runtime."""

from a2ui.core.schema import A2uiMessageListWrapper
from langchain_core.callbacks.manager import adispatch_custom_event
from langgraph.config import get_config

from agent_playground.db.workflow_outputs import store_workflow_output


async def publish_workflow_output(
    *,
    workflow_call_id: str,
    step_id: str,
    step_seq: int,
    card: A2uiMessageListWrapper,
) -> None:
    config = get_config()
    metadata = config.get("metadata") or {}
    configurable = config.get("configurable") or {}
    agui_run_id = metadata.get("agui_run_id")
    thread_id = configurable.get("thread_id")

    if not isinstance(agui_run_id, str) or not isinstance(thread_id, str):
        raise TypeError("Workflow output is missing AG-UI run or thread ID")

    output = await store_workflow_output(
        thread_id=thread_id,
        agui_run_id=agui_run_id,
        workflow_call_id=workflow_call_id,
        step_id=step_id,
        step_seq=step_seq,
        payload=card.model_dump(mode="json", by_alias=True, exclude_none=True),
    )

    await adispatch_custom_event(
        "a2ui",
        {
            "id": output.id,
            "aguiRunId": output.agui_run_id,
            "workflowCallId": workflow_call_id,
            "outputSeq": output.output_seq,
            "toolCallId": workflow_call_id,
            **output.payload,
        },
    )
