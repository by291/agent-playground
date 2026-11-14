"""Build complete A2UI cards for experiment workflow steps."""

from dataclasses import dataclass
from typing import Literal

from a2ui.core.schema.v0_9 import A2uiMessageListWrapper

from agent_playground.workflows.cards import WorkflowContent, content_card
from agent_playground.workflows.output import (
    PublishWorkflowOutput,
    publish_workflow_output,
)

ExperimentStage = Literal["idea", "draft", "review", "reviewed"]
EXPERIMENT_STEP_SEQUENCE: dict[ExperimentStage, int] = {
    "idea": 1,
    "draft": 2,
    "review": 3,
    "reviewed": 4,
}


@dataclass(frozen=True)
class ExperimentCard:
    workflow_call_id: str
    title: str
    stage: ExperimentStage
    heading: str
    lines: list[str]


def experiment_card(request: ExperimentCard) -> A2uiMessageListWrapper:
    """Render an experiment stage as a complete card."""
    return content_card(
        WorkflowContent(
            surface_id=f"experiment-{request.workflow_call_id}-{request.stage}",
            title=request.title,
            heading=request.heading,
            lines=request.lines,
        )
    )


async def publish_experiment_card(request: ExperimentCard) -> None:
    """Persist and publish an experiment stage using its deterministic order."""
    card = experiment_card(request)

    await publish_workflow_output(
        PublishWorkflowOutput(
            workflow_call_id=request.workflow_call_id,
            step_id=request.stage,
            step_seq=EXPERIMENT_STEP_SEQUENCE[request.stage],
            card=card,
        )
    )
