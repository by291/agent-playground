"""Stable request identities shared by A2A agents and their coordinator."""

import hashlib
import json
from typing import Literal

from a2a.types import SendMessageRequest, TaskState
from google.protobuf.json_format import MessageToDict

AgentRole = Literal["planner", "reviewer"]

TERMINAL_TASK_STATES = frozenset(
    {
        TaskState.TASK_STATE_COMPLETED,
        TaskState.TASK_STATE_CANCELED,
        TaskState.TASK_STATE_FAILED,
        TaskState.TASK_STATE_REJECTED,
    }
)


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
