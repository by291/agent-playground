"""Start report jobs that complete independently and report callback progress."""

import asyncio

from fastapi import APIRouter, HTTPException

from agent_playground.db.report_jobs import create_report_job
from agent_playground.services.report.models import ReportRequest

router = APIRouter(prefix="/report-demo", tags=["Report demonstration"])


@router.post("/jobs", status_code=202)
async def start_report(request: ReportRequest) -> dict[str, str]:
    try:
        job = await asyncio.to_thread(
            create_report_job,
            job_id=request.id,
            task=request.task,
            callback_token=request.callback_token,
            outcome=request.outcome,
        )
    except ValueError as error:
        raise HTTPException(409, str(error)) from error

    return {"jobId": job.id, "status": "queued"}
