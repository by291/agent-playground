"""Report service requests and external callback snapshots."""

from typing import Any, Literal

from pydantic import BaseModel, Field


class ReportRequest(BaseModel):
    id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,200}$")
    task: str = Field(min_length=1, max_length=10000)
    callback_token: str = Field(min_length=1)
    outcome: Literal["succeeded", "failed"] = "succeeded"


class ReportEvent(BaseModel):
    revision: int
    status: Literal["queued", "running", "succeeded", "failed"]
    stage: str
    message: str
    progress: int
    result: dict[str, Any] | None = None
    error: str | None = None
