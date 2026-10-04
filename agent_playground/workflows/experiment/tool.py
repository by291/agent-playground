"""Agent tool entry point for experiment planning."""

from langchain.tools import tool
from langgraph.prebuilt import ToolRuntime

from agent_playground.workflows.experiment.graph import (
    ExperimentState,
    experiment_workflow,
)


@tool
async def run_experiment_workflow(idea: str, runtime: ToolRuntime) -> str:
    """Run a visible experiment-planning workflow with a human review step."""
    if not runtime.tool_call_id:
        raise ValueError("Workflow requires a stable tool call ID")

    result = await experiment_workflow.ainvoke(
        ExperimentState(
            idea=idea,
            card_group_id=runtime.tool_call_id,
        )
    )
    completed = ExperimentState.model_validate(result)

    if completed.review_status == "rejected":
        return "The reviewer rejected the experiment plan."

    steps = "\n".join(
        f"{index}. {step}" for index, step in enumerate(completed.steps, 1)
    )

    return f"Approved experiment plan: {completed.title}\n{steps}"
