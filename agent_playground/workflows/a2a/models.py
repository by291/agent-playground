"""Checkpointed state for one external A2A collaboration workflow."""

from typing import Any, Literal

from pydantic import BaseModel


class A2aState(BaseModel):
    task: str
    workflow_call_id: str
    require_input: bool = False
    task_id: str = ""
    callback_token: str = ""
    status: Literal["succeeded", "failed", "cancelled"] | None = None
    result: dict[str, Any] | None = None
    error: str | None = None
