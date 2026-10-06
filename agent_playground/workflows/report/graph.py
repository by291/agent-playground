"""Submit an asynchronous API job, wait durably and publish its result."""

from typing import Any, Literal

from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel

from agent_playground.workflows.cards import content_card
from agent_playground.workflows.external import (
    register_external_task,
    wait_for_external_task,
)
from agent_playground.workflows.output import (
    WorkflowOutputMetadata,
    WorkflowPresentation,
    publish_workflow_output,
)
from agent_playground.workflows.report.api import HttpReportApi


class ReportState(BaseModel):
    task: str
    workflow_call_id: str
    outcome: Literal["succeeded", "failed"] = "succeeded"
    task_id: str = ""
    callback_token: str = ""
    result: dict[str, Any] | None = None
    error: str | None = None
    status: Literal["succeeded", "failed"] | None = None


def make_report_workflow():
    async def register(state: ReportState) -> dict[str, str]:
        registration = await register_external_task(
            workflow_call_id=state.workflow_call_id,
            step_id="report",
            label="Generate report",
        )

        return {
            "task_id": registration.task_id,
            "callback_token": registration.callback_token,
        }

    async def submit(state: ReportState) -> dict[str, str]:
        registration = {
            "task_id": state.task_id,
            "callback_token": state.callback_token,
        }

        # Older checkpoints entered submit before persisting registration.
        # Re-registering returns the original identity and callback credential.
        if not state.task_id or not state.callback_token:
            registration = await register(state)

        await HttpReportApi().submit(
            task_id=registration["task_id"],
            task=state.task,
            callback_token=registration["callback_token"],
            outcome=state.outcome,
        )

        return registration

    def wait(state: ReportState) -> dict[str, Any]:
        completed = wait_for_external_task(
            task_id=state.task_id, workflow_call_id=state.workflow_call_id
        )

        return {
            "result": completed.result,
            "error": completed.error,
            "status": completed.status,
        }

    async def publish(state: ReportState) -> None:
        success = state.status == "succeeded"
        lines = (
            [str((state.result or {}).get("summary", "The report is ready."))]
            if success
            else [state.error or "Report generation failed."]
        )
        await publish_workflow_output(
            workflow_call_id=state.workflow_call_id,
            step_id="result",
            step_seq=1,
            card=content_card(
                surface_id=f"report-{state.workflow_call_id}-result",
                title="Generated report" if success else "Report failed",
                heading="REPORT READY" if success else "REPORT FAILED",
                lines=lines,
            ),
            workflow=WorkflowOutputMetadata(
                presentation=WorkflowPresentation(
                    surface_id=f"report-{state.workflow_call_id}-result",
                    group_id=state.workflow_call_id,
                )
            ),
        )

    builder = StateGraph(ReportState)
    builder.add_node("register", register)
    builder.add_node("submit", submit)
    builder.add_node("wait", wait)
    builder.add_node("publish", publish)
    builder.add_edge(START, "register")
    builder.add_edge("register", "submit")
    builder.add_edge("submit", "wait")
    builder.add_edge("wait", "publish")
    builder.add_edge("publish", END)

    return builder.compile()
