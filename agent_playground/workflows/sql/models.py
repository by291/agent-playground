"""SQL service contracts and checkpointed workflow state."""

from collections.abc import Awaitable, Callable
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class SqlSource(BaseModel):
    sql: str
    dialect: str
    schema_text: str


class SqlCheck(BaseModel):
    passed: bool
    issues: list[str]


class SqlSubmission(BaseModel):
    id: str
    sql: str
    status: str


class SqlRevision(BaseModel):
    reply: str = Field(min_length=1)
    sql: str | None = None


class SqlReviewResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    action: Literal["message", "accept", "abandon"]
    workflow_call_id: str = Field(alias="workflowCallId")
    revision: int
    round: int
    message: str | None = None


class SqlState(BaseModel):
    task: str
    workflow_call_id: str
    original_sql: str = ""
    sql: str = ""
    dialect: str = "postgres"
    schema_text: str = ""
    revision: int = 1
    round: int = 0
    check: SqlCheck | None = None
    checked_revision: int = 0
    feedback: str = ""
    dialogue: list[dict[str, str]] = Field(default_factory=list)
    reply: str = ""
    action: Literal["message", "accept", "abandon"] | None = None
    status: Literal["review", "submitted", "abandoned"] = "review"
    submission: SqlSubmission | None = None


RevisionAgent = Callable[[SqlState], Awaitable[SqlRevision]]
