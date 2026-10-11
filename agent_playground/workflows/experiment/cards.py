"""Build complete A2UI cards for experiment workflow steps."""

from typing import Literal

from a2ui.core.schema.v0_9 import A2uiMessageListWrapper

from agent_playground.workflows.cards import content_card
from agent_playground.workflows.output import publish_workflow_output

ExperimentStage = Literal["idea", "draft", "review", "reviewed"]
EXPERIMENT_STEP_SEQUENCE: dict[ExperimentStage, int] = {
    "idea": 1,
    "draft": 2,
    "review": 3,
    "reviewed": 4,
}


def experiment_card(
    *,
    workflow_call_id: str,
    title: str,
    stage: ExperimentStage,
    heading: str,
    lines: list[str],
) -> A2uiMessageListWrapper:
    return content_card(
        surface_id=f"experiment-{workflow_call_id}-{stage}",
        title=title,
        heading=heading,
        lines=lines,
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
