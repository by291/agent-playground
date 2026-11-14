"""Submit one durable collaboration job with replay-safe identity."""

from dataclasses import dataclass

import httpx
from pydantic import ValidationError

from agent_playground.config.agent import load_agent_config, workflow_api_token
from agent_playground.services.a2a.contracts import CollaborationRequest
from agent_playground.workflows.submission import (
    INITIAL_FAILURE_REVISION,
    JOB_SUBMISSION_TIMEOUT_SECONDS,
    ExternalTaskCallback,
    JobSubmission,
    publish_submission_failure,
    submit_checkpointed_job,
)


@dataclass(frozen=True)
class A2aSubmission:
    task_id: str
    task: str
    callback_token: str
    require_input: bool


def _rejection_event(error: str) -> dict[str, str | int]:
    return {
        "revision": INITIAL_FAILURE_REVISION,
        "kind": "a2a",
        "status": "failed",
        "stage": "submission",
        "message": "A2A submission failed",
        "error": error,
    }


class HttpA2aApi:
    def __init__(self) -> None:
        self.base_url = load_agent_config().a2a.demo_api_url

    async def submit(self, submission: A2aSubmission) -> None:
        """Send a validated collaboration request and report definite failure."""
        internal_token = workflow_api_token()
        callback = ExternalTaskCallback(
            task_id=submission.task_id, token=submission.callback_token
        )

        async with httpx.AsyncClient(timeout=JOB_SUBMISSION_TIMEOUT_SECONDS) as client:
            try:
                request = CollaborationRequest(
                    id=submission.task_id,
                    task=submission.task,
                    callbackToken=submission.callback_token,
                    requireInput=submission.require_input,
                )
            except ValidationError:
                event = _rejection_event("Invalid A2A request.")
                await publish_submission_failure(client, callback, event)

                return

            def validate_job(response: httpx.Response) -> None:
                receipt = response.json()
                matches_request = (
                    receipt.get("jobId") == request.id
                    and receipt.get("task") == request.task
                    and receipt.get("requireInput") == request.require_input
                )

                if not matches_request:
                    raise ValueError("A2A job does not match the checkpointed request")

            await submit_checkpointed_job(
                client,
                JobSubmission(
                    service_name="A2A",
                    jobs_url=f"{self.base_url}/jobs",
                    callback=callback,
                    request_body=request.model_dump(by_alias=True),
                    validate_job=validate_job,
                    rejection_event=_rejection_event,
                    headers={"Authorization": f"Bearer {internal_token}"},
                ),
            )
