"""Submit reports and reconcile ambiguous responses using the original task ID."""

import os
from typing import Literal

import httpx
from pydantic import ValidationError

from agent_playground.config import app_api_url
from agent_playground.services.report.models import (
    ReportEvent,
    ReportJobStatus,
    ReportRequest,
)


class HttpReportApi:
    def __init__(self):
        self.base_url = os.getenv(
            "REPORT_DEMO_API_URL", "http://127.0.0.1:2026/report-demo"
        ).rstrip("/")

    async def submit(
        self,
        *,
        task_id: str,
        task: str,
        callback_token: str,
        outcome: Literal["succeeded", "failed"],
    ) -> None:
        async with httpx.AsyncClient(timeout=30) as client:
            try:
                request = ReportRequest(
                    id=task_id,
                    task=task,
                    callback_token=callback_token,
                    outcome=outcome,
                )
            except ValidationError:
                await self.reject(
                    client,
                    task_id,
                    callback_token,
                    "Report submission rejected: invalid report request.",
                )
                return

            submission_error: httpx.HTTPError | None = None
            write_unconfirmed = False

            # Checkpoint replay can follow an accepted write from an earlier run.
            # Confirm that identity before allowing a fresh rejection to end it.
            try:
                if await self.accepted(client, request):
                    return
            except httpx.HTTPError as error:
                submission_error = error
                write_unconfirmed = True

            for _ in range(2):
                response = None

                try:
                    response = await client.post(
                        f"{self.base_url}/jobs", json=request.model_dump()
                    )
                except httpx.TransportError as error:
                    submission_error = error

                if response is not None:
                    definite_rejection = (
                        400 <= response.status_code < 500
                        and response.status_code not in {408, 429}
                    )

                    # A later rejection cannot establish that an earlier timed-out
                    # write never committed. Keep reconciling that original job.
                    if definite_rejection and not write_unconfirmed:
                        await self.reject(
                            client,
                            task_id,
                            callback_token,
                            f"Report submission rejected (HTTP {response.status_code}).",
                        )
                        return

                    try:
                        response.raise_for_status()
                    except httpx.HTTPStatusError as error:
                        submission_error = error
                    else:
                        if response.json().get("jobId") != task_id:
                            raise ValueError(
                                "Report submission receipt targets a different task"
                            )

                        return

                write_unconfirmed = True

                # A timeout or server error can follow a committed job. Look it up
                # before replaying the same request; never create another task ID.
                try:
                    if await self.accepted(client, request):
                        return
                except httpx.HTTPError as error:
                    submission_error = error

            # An unconfirmed write is not a rejection. Registration was already
            # checkpointed, so replay resumes submission with the same identity.
            if submission_error is not None:
                raise submission_error

    async def accepted(self, client: httpx.AsyncClient, request: ReportRequest) -> bool:
        response = await client.get(
            f"{self.base_url}/jobs/{request.id}",
            headers={"Authorization": f"Bearer {request.callback_token}"},
        )

        if response.status_code == 404:
            return False

        response.raise_for_status()
        receipt = ReportJobStatus.model_validate(response.json())

        if (receipt.job_id, receipt.task, receipt.outcome) != (
            request.id,
            request.task,
            request.outcome,
        ):
            raise ValueError("Report job does not match the checkpointed request")

        return True

    async def reject(
        self, client: httpx.AsyncClient, task_id: str, callback_token: str, error: str
    ) -> None:
        event = ReportEvent(
            revision=1,
            status="failed",
            stage="failed",
            message="Report submission failed",
            progress=0,
            error=error,
        )
        response = await client.post(
            f"{app_api_url()}/external-tasks/{task_id}/events",
            headers={"Authorization": f"Bearer {callback_token}"},
            json=event.model_dump(exclude_none=True),
        )
        response.raise_for_status()
