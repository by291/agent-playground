"""Deliver persistent demonstration job events without browser participation."""

import asyncio
import logging
from http import HTTPStatus

import httpx

from agent_playground.config.agent import app_api_url
from agent_playground.db.async_operations import run_database_operation
from agent_playground.db.report_jobs import (
    mark_report_event_delivered,
    stop_report_job,
)
from agent_playground.services.report.jobs import FINAL_REVISION, pending_report_events

logger = logging.getLogger(__name__)
CALLBACK_TIMEOUT_SECONDS = 10
REPORT_POLL_SECONDS = 0.5


async def deliver_report_events(client: httpx.AsyncClient) -> None:
    """Send due callbacks and acknowledge each revision accepted by its owner."""
    events = await run_database_operation(pending_report_events)

    for job, event in events:
        try:
            response = await client.post(
                f"{app_api_url()}/external-tasks/{job.id}/events",
                headers={"Authorization": f"Bearer {job.callback_token}"},
                json=event.model_dump(exclude_none=True),
            )

            if response.status_code == HTTPStatus.NOT_FOUND:
                # A deleted conversation can no longer receive callbacks.
                await run_database_operation(stop_report_job, job.id, FINAL_REVISION)

                continue

            response.raise_for_status()

            # A delivery error leaves this revision pending for the next scan.
            # Acknowledgement must follow the backend's accepted callback.
            await run_database_operation(
                mark_report_event_delivered, job.id, event.revision
            )
        except httpx.HTTPError:
            logger.warning("Report event delivery will be retried for job %s", job.id)


async def run_report_worker() -> None:
    """Poll durable jobs while owning the callback client."""
    async with httpx.AsyncClient(timeout=CALLBACK_TIMEOUT_SECONDS) as client:
        while True:
            try:
                await deliver_report_events(client)
            except Exception:
                logger.exception("Report event scan failed")

            await asyncio.sleep(REPORT_POLL_SECONDS)
