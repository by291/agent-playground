"""Build complete A2UI cards for experiment workflow steps."""

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

from agent_playground.workflow_outputs import publish_workflow_output

ExperimentStage = Literal["idea", "draft", "review", "reviewed"]
EXPERIMENT_STEP_SEQUENCE: dict[ExperimentStage, int] = {
    "idea": 1,
    "draft": 2,
    "review": 3,
    "reviewed": 4,
}

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


def experiment_card(
    *,
    workflow_call_id: str,
    title: str,
    stage: ExperimentStage,
    heading: str,
    lines: list[str],
) -> A2uiMessageListWrapper:
    """Return protocol messages for one workflow step."""
    surface_id = f"experiment-{workflow_call_id}-{stage}"
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

    return A2uiMessageListWrapper(
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


async def publish_experiment_card(
    *,
    workflow_call_id: str,
    title: str,
    stage: ExperimentStage,
    heading: str,
    lines: list[str],
) -> None:
    await publish_workflow_output(
        workflow_call_id=workflow_call_id,
        step_id=stage,
        step_seq=EXPERIMENT_STEP_SEQUENCE[stage],
        card=experiment_card(
            workflow_call_id=workflow_call_id,
            title=title,
            stage=stage,
            heading=heading,
            lines=lines,
        ),
    )
