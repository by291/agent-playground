"""Private memory management API for the application server."""

from hmac import compare_digest
from typing import Annotated
from uuid import UUID

from aegra_api.core.database import db_manager
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response

from agent_playground.config.agent import workflow_api_token
from agent_playground.memory.models import (
    MemoryEdit,
    MemoryMutation,
    MemoryPage,
    MemoryView,
)
from agent_playground.memory.service import MemoryService


def require_memory_credential(authorization: str | None) -> None:
    expected = workflow_api_token()
    supplied = (authorization or "").removeprefix("Bearer ")

    if (
        not expected
        or not (authorization or "").startswith("Bearer ")
        or not compare_digest(supplied.encode(), expected.encode())
    ):
        raise HTTPException(401, "Invalid application credential")


def memory_service(
    authorization: Annotated[str | None, Header()] = None,
) -> MemoryService:
    require_memory_credential(authorization)

    try:
        return MemoryService(db_manager.get_store())
    except RuntimeError as error:
        raise HTTPException(503, "Memory storage is unavailable") from error


Service = Annotated[MemoryService, Depends(memory_service)]
router = APIRouter(prefix="/memory", tags=["Memory"])


@router.get("", response_model=MemoryPage)
async def list_memories(
    service: Service,
    offset: Annotated[int, Query(ge=0, le=1_000_000)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
):
    return await service.list_memories(offset=offset, limit=limit)


@router.patch("/{memory_id}", response_model=MemoryView)
async def edit_memory(memory_id: UUID, request: MemoryEdit, service: Service):
    try:
        return await service.save(
            request, request.text, str(memory_id), revision=request.revision
        )
    except LookupError as error:
        raise HTTPException(404, str(error)) from error
    except ValueError as error:
        raise HTTPException(409, str(error)) from error


@router.delete("/{memory_id}", status_code=204)
async def forget_memory(memory_id: UUID, request: MemoryMutation, service: Service):
    try:
        await service.forget(request, str(memory_id), revision=request.revision)
    except LookupError as error:
        raise HTTPException(404, str(error)) from error
    except ValueError as error:
        raise HTTPException(409, str(error)) from error

    return Response(status_code=204)
