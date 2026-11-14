"""Build content cards from the shared A2UI workflow components."""

from collections.abc import Sequence
from dataclasses import dataclass
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

WORKFLOW_CATALOG_ID = "urn:agent-playground:workflow:v1"


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


@dataclass(frozen=True)
class WorkflowContent:
    surface_id: str
    title: str
    heading: str
    lines: list[str]


def workflow_surface(
    surface_id: str, components: Sequence[BaseModel]
) -> A2uiMessageListWrapper:
    """Wrap the workflow's typed components in a complete A2UI surface."""
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


def content_card(content: WorkflowContent) -> A2uiMessageListWrapper:
    """Return a workflow surface for an ordered list of steps."""
    step_ids = [ComponentId(f"step-{index}") for index in range(len(content.lines))]
    components: list[WorkflowPanel | WorkflowText | WorkflowSteps] = [
        WorkflowPanel(
            id=ComponentId("root"),
            children=[
                ComponentId("eyebrow"),
                ComponentId("title"),
                ComponentId("steps"),
            ],
        ),
        WorkflowText(id=ComponentId("eyebrow"), text=content.heading, role="eyebrow"),
        WorkflowText(id=ComponentId("title"), text=content.title, role="title"),
        WorkflowSteps(id=ComponentId("steps"), children=step_ids),
        *[
            WorkflowText(id=step_id, text=line, role="step")
            for step_id, line in zip(step_ids, content.lines, strict=True)
        ],
    ]

    return workflow_surface(content.surface_id, components)
