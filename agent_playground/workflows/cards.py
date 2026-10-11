"""Build content cards from the shared A2UI workflow components."""

from typing import Literal

from a2ui.core.schema.v0_9 import (
    A2uiMessageListWrapper,
    CreateSurface,
    CreateSurfaceMessage,
    UpdateComponents,
    UpdateComponentsMessage,
)
from a2ui.core.schema.v0_9.common_types import ComponentId
from pydantic import BaseModel

from agent_playground.workflows.output import (
    WORKFLOW_CATALOG_ID,
)


class WorkflowPanel(BaseModel):
    id: ComponentId
    component: Literal["WorkflowPanel"] = "WorkflowPanel"
    children: list[ComponentId]


class WorkflowText(BaseModel):
    id: ComponentId
    component: Literal["WorkflowText"] = "WorkflowText"
    text: str
    role: Literal["eyebrow", "title", "body", "step"]


class WorkflowSteps(BaseModel):
    id: ComponentId
    component: Literal["WorkflowSteps"] = "WorkflowSteps"
    children: list[ComponentId]


def content_card(
    *,
    surface_id: str,
    title: str,
    heading: str,
    lines: list[str],
) -> A2uiMessageListWrapper:
    """Return protocol messages for one workflow step."""
    step_ids = [ComponentId(f"step-{index}") for index in range(len(lines))]
    components: list[WorkflowPanel | WorkflowText | WorkflowSteps] = [
        WorkflowPanel(
            id=ComponentId("root"),
            children=[
                ComponentId("eyebrow"),
                ComponentId("title"),
                ComponentId("steps"),
            ],
        ),
        WorkflowText(id=ComponentId("eyebrow"), text=heading, role="eyebrow"),
        WorkflowText(id=ComponentId("title"), text=title, role="title"),
        WorkflowSteps(id=ComponentId("steps"), children=step_ids),
        *[
            WorkflowText(id=step_id, text=line, role="step")
            for step_id, line in zip(step_ids, lines, strict=True)
        ],
    ]

    # The protocol envelope accepts JSON mappings, while our catalog stays typed.
    component_payloads = [
        component.model_dump(mode="json", by_alias=True, exclude_none=True)
        for component in components
    ]

    return A2uiMessageListWrapper(
        messages=[
            CreateSurfaceMessage(
                create_surface=CreateSurface(
                    surface_id=surface_id, catalog_id=WORKFLOW_CATALOG_ID
                )
            ),
            UpdateComponentsMessage(
                update_components=UpdateComponents(
                    surface_id=surface_id, components=component_payloads
                )
            ),
        ]
    )
