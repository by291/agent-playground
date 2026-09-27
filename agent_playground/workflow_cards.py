"""Build complete A2UI cards for experiment workflow steps."""

from typing import Literal

from a2ui.core.schema import (
    A2uiMessage,
    CreateSurface,
    CreateSurfaceMessage,
    UpdateComponents,
    UpdateComponentsMessage,
)
from a2ui.core.schema.common_types import ComponentId
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


class ExperimentCard(BaseModel):
    kind: Literal["a2ui"] = "a2ui"
    messages: list[A2uiMessage]


def experiment_card(
    card_group_id: str, title: str, stage: str, heading: str, lines: list[str]
) -> ExperimentCard:
    """Return protocol messages for one workflow step."""
    surface_id = f"experiment-{card_group_id}-{stage}"
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
    return ExperimentCard(
        messages=[
            CreateSurfaceMessage(
                create_surface=CreateSurface(
                    surface_id=surface_id, catalog_id=WORKFLOW_CATALOG_ID
                )
            ),
            UpdateComponentsMessage(
                update_components=UpdateComponents(
                    surface_id=surface_id, components=components
                )
            ),
        ]
    )
