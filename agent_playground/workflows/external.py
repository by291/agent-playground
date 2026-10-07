"""Register durable external tasks and wait for trusted backend continuation."""

import os
from hashlib import sha256
from typing import Any, Literal

import httpx
from langgraph.config import get_config
from langgraph.types import interrupt
from pydantic import BaseModel, ConfigDict, Field, model_validator

from agent_playground.config import app_api_url


class ExternalTaskRegistration(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    task_id: str = Field(alias="taskId")
    callback_token: str = Field(alias="callbackToken")


class ExternalTaskResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    kind: Literal["external_task_result"]
    task_id: str = Field(alias="taskId")
    revision: int = Field(gt=0)
    status: Literal["succeeded", "failed", "cancelled"]
    result: dict[str, Any] | None = None
    error: str | None = None

    @model_validator(mode="after")
    def validate_terminal_content(self):
        if self.status == "succeeded" and self.result is None:
            raise ValueError("A successful external task requires a result")
        if self.status == "failed" and not self.error:
            raise ValueError("A failed external task requires an error")

        return self


async def register_external_task(
    *, workflow_call_id: str, step_id: str, label: str
) -> ExternalTaskRegistration:
    config = get_config()
    thread_id = (config.get("configurable") or {}).get("thread_id")
    run_id = (config.get("metadata") or {}).get("agui_run_id")
    token = os.getenv("WORKFLOW_API_TOKEN")

    if not isinstance(thread_id, str) or not isinstance(run_id, str) or not token:
        raise ValueError(
            "External task registration requires run identity and WORKFLOW_API_TOKEN"
        )

    task_id = (
        "task-"
        + sha256(f"{thread_id}:{workflow_call_id}:{step_id}".encode()).hexdigest()
    )

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            f"{app_api_url()}/internal/external-tasks",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "taskId": task_id,
                "threadId": thread_id,
                "runId": run_id,
                "workflowCallId": workflow_call_id,
                "stepId": step_id,
                "label": label,
            },
        )
        response.raise_for_status()

    return ExternalTaskRegistration.model_validate(response.json())


def wait_for_external_task(
    *, task_id: str, workflow_call_id: str
) -> ExternalTaskResult:
    result = ExternalTaskResult.model_validate(
        interrupt(
            {
                "kind": "workflow_external_wait",
                "taskId": task_id,
                "workflowCallId": workflow_call_id,
            },
            response_schema=ExternalTaskResult,
        )
    )

    if result.task_id != task_id:
        raise ValueError("External task result targets a different task")

    return result
