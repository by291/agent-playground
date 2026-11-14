"""Submit report jobs under the identity stored by the workflow."""

from dataclasses import dataclass
from typing import Any, Literal

import httpx
from pydantic import ValidationError

from agent_playground.config.agent import load_agent_config
from agent_playground.services.report.models import (
    ReportEvent,
    ReportJobStatus,
    ReportRequest,
)
from agent_playground.workflows.submission import (
    INITIAL_FAILURE_REVISION,
    JOB_SUBMISSION_TIMEOUT_SECONDS,
    ExternalTaskCallback,
    JobSubmission,
    publish_submission_failure,
    submit_checkpointed_job,
)


@dataclass(frozen=True)
class ReportSubmission:
    task_id: str
    task: str
    callback_token: str
    outcome: Literal["succeeded", "failed"]


def _rejection_event(error: str) -> dict[str, Any]:
    event = ReportEvent(
        revision=INITIAL_FAILURE_REVISION,
        status="failed",
        stage="failed",
        message="Report submission failed",
        progress=0,
        error=error,
    )

    return event.model_dump(exclude_none=True)


class HttpReportApi:
    def __init__(self) -> None:
        self.base_url = load_agent_config().services.report_demo_url

    async def submit(self, submission: ReportSubmission) -> None:
        """Send a validated report request and report definite failure to the workflow."""
        callback = ExternalTaskCallback(
            task_id=submission.task_id, token=submission.callback_token
        )

        async with httpx.AsyncClient(timeout=JOB_SUBMISSION_TIMEOUT_SECONDS) as client:
            try:
                request = ReportRequest(
                    id=submission.task_id,
                    task=submission.task,
                    callback_token=submission.callback_token,
                    outcome=submission.outcome,
                )
            except ValidationError:
                event = _rejection_event(
                    "Report submission rejected: invalid report request."
                )
                await publish_submission_failure(client, callback, event)

                return

            def validate_job(response: httpx.Response) -> None:
                receipt = ReportJobStatus.model_validate(response.json())
                matches_request = (
                    receipt.job_id == request.id
                    and receipt.task == request.task
                    and receipt.outcome == request.outcome
                )

                if not matches_request:
                    raise ValueError(
                        "Report job does not match the checkpointed request"
                    )

            await submit_checkpointed_job(
                client,
                JobSubmission(
                    service_name="Report",
                    jobs_url=f"{self.base_url}/jobs",
                    callback=callback,
                    request_body=request.model_dump(),
                    validate_job=validate_job,
                    rejection_event=_rejection_event,
                ),
            )
