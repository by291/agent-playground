"""Expose the asynchronous report business example to the parent agent."""

from typing import Literal

from langchain.tools import ToolRuntime, tool

from agent_playground.workflows.report.graph import ReportState, make_report_workflow

workflow = make_report_workflow()


@tool
async def run_report_workflow(
    task: str,
    runtime: ToolRuntime,
    outcome: Literal["succeeded", "failed"] = "succeeded",
) -> str:
    """Generate a demo report asynchronously with external progress updates. Use outcome='failed' only to simulate a failure."""
    if not runtime.tool_call_id:
        raise ValueError("Report workflow requires a stable tool call ID")

    result = await workflow.ainvoke(
        ReportState(task=task, workflow_call_id=runtime.tool_call_id, outcome=outcome)
    )
    completed = ReportState.model_validate(result)

    if completed.status == "failed":
        return f"Report generation failed: {completed.error}"

    return "The report service finished and the result is displayed in the report card."
