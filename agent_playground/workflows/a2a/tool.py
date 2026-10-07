"""Expose independent agent collaboration to the conversation agent."""

from langchain.tools import ToolRuntime, tool

from agent_playground.workflows.a2a.graph import A2aState, make_a2a_workflow

workflow = make_a2a_workflow()


@tool
async def run_a2a_workflow(
    task: str, runtime: ToolRuntime, require_input: bool = False
) -> str:
    """Delegate a proposal to independent A2A planner and reviewer agents, then revise it. Their output streams into the conversation; users can cancel. Set require_input=True only to demonstrate a child agent asking for additional information."""
    if not runtime.tool_call_id:
        raise ValueError("A2A collaboration requires a stable tool call ID")

    result = await workflow.ainvoke(
        A2aState(
            task=task,
            workflow_call_id=runtime.tool_call_id,
            require_input=require_input,
        )
    )
    completed = A2aState.model_validate(result)

    if completed.status == "failed":
        return f"A2A collaboration failed: {completed.error}"
    if completed.status == "cancelled":
        return (
            "The A2A collaboration was cancelled. Partial child output remains visible."
        )

    return "The planner produced a proposal, the reviewer evaluated it, and the planner revised it. Child outputs and the final proposal are displayed in the conversation."
