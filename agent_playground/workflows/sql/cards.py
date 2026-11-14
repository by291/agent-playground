"""Publish complete, durable SQL cards for individual interaction rounds."""

from typing import Literal

from a2ui.core.schema.v0_9 import A2uiMessageListWrapper
from a2ui.core.schema.v0_9.common_types import ComponentId
from pydantic import BaseModel

from agent_playground.services.sql.models import SqlCheck
from agent_playground.workflows.cards import workflow_surface
from agent_playground.workflows.output import (
    PublishWorkflowOutput,
    WorkflowOutputMetadata,
    WorkflowPresentation,
    WorkflowReply,
    publish_workflow_output,
)
from agent_playground.workflows.sql.models import SqlState


class WorkflowSql(BaseModel):
    id: ComponentId = ComponentId("root")
    component: Literal["WorkflowSql"] = "WorkflowSql"
    workflowCallId: str
    sql: str
    originalSql: str
    revision: int
    round: int
    status: Literal["review", "submitted", "abandoned"]
    check: SqlCheck
    receiptId: str | None = None


def sql_card(state: SqlState) -> A2uiMessageListWrapper:
    """Render one checked SQL revision as a workflow card."""
    if state.check is None:
        raise ValueError("SQL card requires a check result")

    surface_id = f"sql-{state.workflow_call_id}-{state.round}"
    component = WorkflowSql(
        workflowCallId=state.workflow_call_id,
        sql=state.sql,
        originalSql=state.original_sql,
        revision=state.revision,
        round=state.round,
        status=state.status,
        check=state.check,
        receiptId=state.submission.id if state.submission else None,
    )
    return workflow_surface(surface_id, [component])


async def publish_sql_card(*, state: SqlState) -> None:
    """Publish the SQL card and associate its reply with the same review round."""
    card = sql_card(state)
    surface_id = f"sql-{state.workflow_call_id}-{state.round}"
    reply_id = f"sql-{state.workflow_call_id}-reply-{state.round}"
    reply = None

    if state.reply:
        reply = WorkflowReply(id=reply_id, content=state.reply)

    presentation = WorkflowPresentation(
        surface_id=surface_id,
        group_id=state.workflow_call_id,
        anchor_message_id=reply_id if state.reply else None,
    )

    await publish_workflow_output(
        PublishWorkflowOutput(
            workflow_call_id=state.workflow_call_id,
            step_id=f"{state.status}:{state.round}",
            step_seq=state.round,
            card=card,
            workflow=WorkflowOutputMetadata(
                reply=reply,
                presentation=presentation,
            ),
        )
    )
