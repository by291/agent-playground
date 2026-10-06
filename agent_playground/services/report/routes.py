"""Start report jobs that complete independently and report callback progress."""

import asyncio
from hmac import compare_digest
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException

from agent_playground.db.report_jobs import create_report_job, read_report_job
from agent_playground.services.report.models import ReportJobStatus, ReportRequest

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


@router.get("/jobs/{job_id}")
async def get_report_job(
    job_id: str, authorization: Annotated[str | None, Header()] = None
) -> ReportJobStatus:
    job = await asyncio.to_thread(read_report_job, job_id)

    if job is None:
        raise HTTPException(404, "Report job not found")

    supplied = (authorization or "").removeprefix("Bearer ")

    if (
        not authorization
        or not authorization.startswith("Bearer ")
        or not compare_digest(supplied.encode(), job.callback_token.encode())
    ):
        raise HTTPException(401, "Invalid report callback credential")

    return ReportJobStatus.model_validate(
        {"jobId": job.id, "task": job.task, "outcome": job.outcome}
    )
