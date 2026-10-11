"""Browser-test bridge using the production worker and retrieval implementation."""

import asyncio
from contextlib import asynccontextmanager, suppress
from typing import Annotated
from uuid import uuid4

from fastapi import FastAPI, Header, Request
from langgraph.store.postgres.aio import AsyncPostgresStore
from pydantic import BaseModel

from agent_playground.config.agent import load_agent_config
from agent_playground.db.connection import close_app_store, prepare_app_store
from agent_playground.db.knowledge import KnowledgeRepository
from agent_playground.knowledge.config import EmbeddingConfig
from agent_playground.knowledge.tools import retrieve
from agent_playground.knowledge.worker import run_knowledge_worker
from agent_playground.memory.models import MemoryEdit
from agent_playground.memory.routes import (
    memory_service,
    require_memory_credential,
)
from agent_playground.memory.routes import (
    router as memory_router,
)
from agent_playground.memory.service import MemoryService


@asynccontextmanager
async def lifespan(application: FastAPI):
    await asyncio.to_thread(prepare_app_store)
    worker = asyncio.create_task(run_knowledge_worker())

    try:
        url = load_agent_config().database.aegra_url.get_secret_value()

        async with AsyncPostgresStore.from_conn_string(url) as store:
            await store.setup()
            application.state.memory_store = store

            yield
    finally:
        worker.cancel()

        with suppress(asyncio.CancelledError):
            await worker

        await asyncio.to_thread(close_app_store)


app = FastAPI(lifespan=lifespan)


def test_memory_service(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
) -> MemoryService:
    require_memory_credential(authorization)

    return MemoryService(request.app.state.memory_store)


app.dependency_overrides[memory_service] = test_memory_service
app.include_router(memory_router)


@app.post("/__e2e/memory/{thread_id}")
async def seed_memory(thread_id: str, input: MemoryEdit, request: Request):
    # Seed through the production LangMem persistence boundary, with provenance
    # pointing to a conversation owned by this isolated browser fixture.
    saved = await MemoryService(request.app.state.memory_store).save(
        input,
        input.text,
        str(uuid4()),
        source_thread_id=thread_id,
        source_message_id=str(uuid4()),
    )

    return saved.model_dump(mode="json", by_alias=True)


class Search(BaseModel):
    query: str


@app.get("/health")
def health():
    return {"ready": True}


@app.post("/search")
async def search(input: Search):
    sources = await retrieve(
        input.query, EmbeddingConfig.from_config(), KnowledgeRepository()
    )

    return {
        "kind": "knowledge_search_result",
        "query": input.query,
        "error": None,
        "sources": sources,
    }
