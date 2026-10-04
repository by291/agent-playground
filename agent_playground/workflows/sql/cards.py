"""Publish complete, durable SQL cards for individual interaction rounds."""

from typing import Literal

from a2ui.core.schema import (
    A2uiMessageListWrapper,
    CreateSurface,
    CreateSurfaceMessage,
    UpdateComponents,
    UpdateComponentsMessage,
)
from a2ui.core.schema.common_types import ComponentId
from pydantic import BaseModel

from agent_playground.workflows.output import (
    WORKFLOW_CATALOG_ID,
    WorkflowOutputMetadata,
    WorkflowPresentation,
    WorkflowReply,
    publish_workflow_output,
)
from agent_playground.workflows.sql.models import SqlCheck, SqlState


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
    if state.check is None:
        raise ValueError("SQL card requires a check result")

    surface_id = f"sql-{state.workflow_call_id}-{state.round}"
    return A2uiMessageListWrapper(
        messages=[
            CreateSurfaceMessage(
                create_surface=CreateSurface(
                    surface_id=surface_id, catalog_id=WORKFLOW_CATALOG_ID
                )
            ),
            UpdateComponentsMessage(
                update_components=UpdateComponents(
                    surface_id=surface_id,
                    components=[
                        WorkflowSql(
                            workflowCallId=state.workflow_call_id,
                            sql=state.sql,
                            originalSql=state.original_sql,
                            revision=state.revision,
                            round=state.round,
                            status=state.status,
                            check=state.check,
                            receiptId=state.submission.id if state.submission else None,
                        )
                    ],
                )
            ),
        ]
    )


async def publish_sql_card(*, state: SqlState) -> None:
    await publish_workflow_output(
        workflow_call_id=state.workflow_call_id,
        step_id=f"{state.status}:{state.round}",
        step_seq=state.round,
        card=sql_card(state),
        workflow=WorkflowOutputMetadata(
            reply=WorkflowReply(
                id=f"sql-{state.workflow_call_id}-reply-{state.round}",
                content=state.reply,
            )
            if state.reply
            else None,
            presentation=WorkflowPresentation(
                surface_id=f"sql-{state.workflow_call_id}-{state.round}",
                group_id=state.workflow_call_id,
                anchor_message_id=f"sql-{state.workflow_call_id}-reply-{state.round}"
                if state.reply
                else None,
            ),
        ),
    )
