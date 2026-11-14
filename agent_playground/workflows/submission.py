"""Submit checkpointed external jobs and reconcile ambiguous writes."""

from collections.abc import Callable
from dataclasses import dataclass
from http import HTTPStatus
from typing import Any

import httpx

from agent_playground.config.agent import app_api_url

JOB_SUBMISSION_TIMEOUT_SECONDS = 30
INITIAL_FAILURE_REVISION = 1
_MAX_SUBMISSION_ATTEMPTS = 2


@dataclass(frozen=True)
class ExternalTaskCallback:
    task_id: str
    token: str


@dataclass(frozen=True)
class JobSubmission:
    service_name: str
    jobs_url: str
    callback: ExternalTaskCallback
    request_body: dict[str, Any]
    validate_job: Callable[[httpx.Response], None]
    rejection_event: Callable[[str], dict[str, Any]]
    headers: dict[str, str] | None = None


async def publish_submission_failure(
    client: httpx.AsyncClient,
    callback: ExternalTaskCallback,
    event: dict[str, Any],
) -> None:
    """Report a definite failure using the original task's callback credential."""
    response = await client.post(
        f"{app_api_url()}/external-tasks/{callback.task_id}/events",
        headers={"Authorization": f"Bearer {callback.token}"},
        json=event,
    )
    response.raise_for_status()


async def _lookup_job(
    client: httpx.AsyncClient, submission: JobSubmission
) -> tuple[bool, httpx.HTTPError | None]:
    callback = submission.callback

    try:
        response = await client.get(
            f"{submission.jobs_url}/{callback.task_id}",
            headers={"Authorization": f"Bearer {callback.token}"},
        )

        if response.status_code == HTTPStatus.NOT_FOUND:
            return False, None

        response.raise_for_status()
        submission.validate_job(response)
    except httpx.HTTPError as error:
        return False, error

    return True, None


async def _submit_once(
    client: httpx.AsyncClient, submission: JobSubmission, *, has_unconfirmed_write: bool
) -> httpx.HTTPError | None:
    try:
        response = await client.post(
            submission.jobs_url,
            headers=submission.headers,
            json=submission.request_body,
        )
    except httpx.TransportError as error:
        return error

    status = response.status_code
    is_definite_rejection = (
        HTTPStatus.BAD_REQUEST <= status < HTTPStatus.INTERNAL_SERVER_ERROR
        and status not in {HTTPStatus.REQUEST_TIMEOUT, HTTPStatus.TOO_MANY_REQUESTS}
    )

    # A later rejection cannot disprove an earlier write whose outcome is unknown.
    if is_definite_rejection and not has_unconfirmed_write:
        error_message = (
            f"{submission.service_name} submission rejected (HTTP {status})."
        )
        event = submission.rejection_event(error_message)
        await publish_submission_failure(client, submission.callback, event)

        return None

    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as error:
        return error

    receipt = response.json()

    if receipt.get("jobId") != submission.callback.task_id:
        raise ValueError(
            f"{submission.service_name} submission receipt targets a different task"
        )

    return None


async def submit_checkpointed_job(
    client: httpx.AsyncClient, submission: JobSubmission
) -> None:
    """Check for a prior write and retry ambiguous submissions under the same identity."""
    # Replay can follow a committed job, so look it up before making another write.
    is_accepted, submission_error = await _lookup_job(client, submission)

    if is_accepted:
        return

    has_unconfirmed_write = submission_error is not None

    for _ in range(_MAX_SUBMISSION_ATTEMPTS):
        write_error = await _submit_once(
            client, submission, has_unconfirmed_write=has_unconfirmed_write
        )

        if write_error is None:
            return

        # A timeout or server error can follow a committed job. Check before retrying.
        has_unconfirmed_write = True
        is_accepted, lookup_error = await _lookup_job(client, submission)

        if is_accepted:
            return

        submission_error = lookup_error if lookup_error is not None else write_error

    # Let checkpoint replay retry the existing registration after an ambiguous outcome.
    if submission_error is not None:
        raise submission_error
