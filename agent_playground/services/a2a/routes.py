"""Authenticated coordinator job submission and conversation controls."""

import os
from hmac import compare_digest
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from agent_playground.db.a2a_jobs import (
    create_job,
    read_job,
    request_cancel,
    request_input,
)
from agent_playground.db.async_operations import run_database_operation
from agent_playground.services.a2a.models import CollaborationRequest

router = APIRouter(prefix="/a2a-demo", tags=["A2A demonstration"])


def check_token(authorization: str | None, expected: str) -> None:
    supplied = (authorization or "").removeprefix("Bearer ")

    if (
        not expected
        or not (authorization or "").startswith("Bearer ")
        or not compare_digest(supplied.encode(), expected.encode())
    ):
        raise HTTPException(401, "Invalid A2A credential")


@router.post("/jobs", status_code=202)
async def submit_job(
    request: CollaborationRequest, authorization: Annotated[str | None, Header()] = None
):
    check_token(authorization, os.getenv("WORKFLOW_API_TOKEN", ""))

    try:
        job = await run_database_operation(create_job, request)
    except ValueError as error:
        raise HTTPException(409, str(error)) from error

    return {"jobId": job.request.id, "status": job.state.status}


async def authorized_job(job_id: str, authorization: str | None):
    job = await run_database_operation(read_job, job_id)

    if job is None:
        raise HTTPException(404, "A2A job not found")

    check_token(authorization, job.request.callback_token)

    return job


@router.get("/jobs/{job_id}")
async def job_status(
    job_id: str, authorization: Annotated[str | None, Header()] = None
):
    job = await authorized_job(job_id, authorization)

    return {
        "jobId": job_id,
        "task": job.request.task,
        "requireInput": job.request.require_input,
        **job.state.event(),
    }


class AdditionalInput(BaseModel):
    input: str = Field(min_length=1, max_length=4000)


@router.post("/jobs/{job_id}/input")
async def supply_input(
    job_id: str,
    request: AdditionalInput,
    authorization: Annotated[str | None, Header()] = None,
):
    await authorized_job(job_id, authorization)

    if not request.input.strip():
        raise HTTPException(400, "Additional information must not be blank")

    try:
        job = await run_database_operation(request_input, job_id, request.input.strip())
    except ValueError as error:
        raise HTTPException(409, str(error)) from error

    return {"jobId": job_id, "status": job.state.status}


@router.post("/jobs/{job_id}/cancel")
async def cancel_job(
    job_id: str, authorization: Annotated[str | None, Header()] = None
):
    await authorized_job(job_id, authorization)

    try:
        job = await run_database_operation(request_cancel, job_id)
    except ValueError as error:
        raise HTTPException(409, str(error)) from error

    return {"jobId": job_id, "status": job.state.status, "cancellationRequested": True}
