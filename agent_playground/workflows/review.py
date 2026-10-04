"""Reusable conversational review contract and LangGraph interrupt boundary."""

from typing import Literal

from langgraph.types import interrupt
from pydantic import BaseModel, ConfigDict, Field


class WorkflowReview(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    kind: Literal["workflow_review"] = "workflow_review"
    workflow_call_id: str = Field(alias="workflowCallId", min_length=1)
    revision: int = Field(gt=0)
    round: int = Field(gt=0)
    output_step_id: str = Field(alias="outputStepId", min_length=1)
    can_accept: bool = Field(alias="canAccept")
    title: str = "Workflow decision"
    accept_label: str = Field(default="Accept", alias="acceptLabel")
    message_placeholder: str = Field(
        default="Ask a question or describe a change…", alias="messagePlaceholder"
    )
    blocked_reason: str | None = Field(default=None, alias="blockedReason")


class WorkflowReviewResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    action: Literal["message", "accept", "abandon"]
    workflow_call_id: str = Field(alias="workflowCallId", min_length=1)
    revision: int = Field(gt=0)
    round: int = Field(gt=0)
    message: str | None = None


def wait_for_review(review: WorkflowReview) -> WorkflowReviewResponse:
    response = WorkflowReviewResponse.model_validate(
        interrupt(
            review.model_dump(by_alias=True, exclude_none=True),
            response_schema=WorkflowReviewResponse,
        )
    )
    current = (
        response.workflow_call_id == review.workflow_call_id
        and response.revision == review.revision
        and response.round == review.round
    )

    if not current:
        raise ValueError("Workflow review is no longer current")

    if response.action == "accept" and not review.can_accept:
        raise ValueError(review.blocked_reason or "This version cannot be accepted")

    if response.action == "message" and not (response.message or "").strip():
        raise ValueError("Workflow feedback requires a message")

    return response
