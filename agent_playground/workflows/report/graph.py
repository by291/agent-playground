"""Submit an asynchronous API job, wait durably and publish its result."""

import os
from typing import Any, Literal

import httpx
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


class ReportState(BaseModel):
    task: str
    workflow_call_id: str
    outcome: Literal["succeeded", "failed"] = "succeeded"
    task_id: str = ""
    result: dict[str, Any] | None = None
    error: str | None = None
    status: Literal["succeeded", "failed"] | None = None


def make_report_workflow():
    async def submit(state: ReportState) -> dict[str, str]:
        registration = await register_external_task(
            workflow_call_id=state.workflow_call_id,
            step_id="report",
            label="Generate report",
        )
        url = os.getenv(
            "REPORT_DEMO_API_URL", "http://127.0.0.1:2026/report-demo"
        ).rstrip("/")

        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                f"{url}/jobs",
                json={
                    "id": registration.task_id,
                    "task": state.task,
                    "callback_token": registration.callback_token,
                    "outcome": state.outcome,
                },
            )
            response.raise_for_status()

        return {"task_id": registration.task_id}

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
    builder.add_node("submit", submit)
    builder.add_node("wait", wait)
    builder.add_node("publish", publish)
    builder.add_edge(START, "submit")
    builder.add_edge("submit", "wait")
    builder.add_edge("wait", "publish")
    builder.add_edge("publish", END)

    return builder.compile()
