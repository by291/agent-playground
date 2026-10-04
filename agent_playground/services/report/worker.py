"""Deliver persistent demonstration job events without browser participation."""

import asyncio
import logging

import httpx

from agent_playground.config import workflow_api_url
from agent_playground.db.report_jobs import (
    mark_report_event_delivered,
    stop_report_job,
)
from agent_playground.services.report.jobs import FINAL_REVISION, pending_report_events

logger = logging.getLogger(__name__)


async def deliver_report_events(client: httpx.AsyncClient) -> None:
    events = await asyncio.to_thread(pending_report_events)

    for job, event in events:
        try:
            response = await client.post(
                f"{workflow_api_url()}/external-tasks/{job.id}/events",
                headers={"Authorization": f"Bearer {job.callback_token}"},
                json=event.model_dump(exclude_none=True),
            )
            if response.status_code == 404:
                await asyncio.to_thread(stop_report_job, job.id, FINAL_REVISION)
                continue

            response.raise_for_status()
            await asyncio.to_thread(mark_report_event_delivered, job.id, event.revision)
        except httpx.HTTPError:
            logger.warning("Report event delivery will be retried for job %s", job.id)


async def run_report_worker() -> None:
    async with httpx.AsyncClient(timeout=10) as client:
        while True:
            try:
                await deliver_report_events(client)
            except Exception:
                logger.exception("Report event scan failed")

            await asyncio.sleep(0.5)
