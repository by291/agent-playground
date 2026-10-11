"""Pure application collaboration state and stable official A2A request identities."""

import hashlib
import json
from typing import Any, Literal

from a2a.types import SendMessageRequest, TaskState
from google.protobuf.json_format import MessageToDict
from pydantic import BaseModel, ConfigDict, Field, field_validator

AgentRole = Literal["planner", "reviewer"]
TaskStatus = Literal[
    "queued", "running", "input_required", "succeeded", "failed", "cancelled"
]
STEPS = ("plan", "review", "revise")

TERMINAL_TASK_STATES = frozenset(
    {
        TaskState.TASK_STATE_COMPLETED,
        TaskState.TASK_STATE_CANCELED,
        TaskState.TASK_STATE_FAILED,
        TaskState.TASK_STATE_REJECTED,
    }
)


class CollaborationRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,200}$")
    task: str = Field(min_length=1, max_length=10000)
    callback_token: str = Field(alias="callbackToken", min_length=1)
    require_input: bool = Field(default=False, alias="requireInput")

    @field_validator("task")
    @classmethod
    def validate_task_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("A2A task must contain text")

        return value


class ChildOutput(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    agent: str
    step: str
    task_id: str = Field(alias="taskId")
    context_id: str = Field(alias="contextId")
    status: TaskStatus
    text: str = Field(default="", max_length=100000)


class CollaborationState(BaseModel):
    revision: int = 1
    status: TaskStatus = "queued"
    stage_index: int = 0
    message: str = "Waiting for the planner agent"
    outputs: list[ChildOutput] = Field(default_factory=list)
    user_input: str | None = None
    cancel_requested: bool = False
    error: str | None = None

    @property
    def terminal(self) -> bool:
        return self.status in {"succeeded", "failed", "cancelled"}

    def event(self) -> dict[str, Any]:
        event: dict[str, Any] = {
            "revision": self.revision,
            "kind": "a2a",
            "status": self.status,
            "stage": STEPS[min(self.stage_index, 2)],
            "message": self.message,
            "progress": min(self.stage_index * 33, 99),
            "outputs": [output.model_dump(by_alias=True) for output in self.outputs],
        }

        if self.status == "succeeded":
            event["progress"] = 100
            event["result"] = {"summary": self.outputs[-1].text}
        elif self.error:
            event["error"] = self.error

        return event


def remote_task_id(message_id: str) -> str:
    return hashlib.sha256(message_id.encode("utf-8")).hexdigest()


def request_fingerprint(request: SendMessageRequest) -> str:
    message = MessageToDict(request.message)

    # The SDK fills these identifiers during dispatch; transport retries may
    # therefore contain them even when the original request omitted them.
    for field in ("messageId", "taskId", "contextId"):
        message.pop(field, None)

    payload = {"message": message, "metadata": MessageToDict(request.metadata)}
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"))

    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()
