"""Browser-test bridge using the production worker and retrieval implementation."""

import asyncio
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from pydantic import BaseModel

from agent_playground.db.connection import app_engine
from agent_playground.db.knowledge import KnowledgeRepository
from agent_playground.knowledge.store import EmbeddingConfig
from agent_playground.knowledge.tools import retrieve
from agent_playground.knowledge.worker import run_knowledge_worker


@asynccontextmanager
async def lifespan(_app: FastAPI):
    worker = asyncio.create_task(run_knowledge_worker())

    try:
        yield
    finally:
        worker.cancel()

        with suppress(asyncio.CancelledError):
            await worker

        app_engine().dispose()
        app_engine.cache_clear()


app = FastAPI(lifespan=lifespan)


class Search(BaseModel):
    query: str


@app.get("/health")
def health():
    return {"ready": True}


@app.post("/search")
async def search(input: Search):
    sources = await retrieve(
        input.query, EmbeddingConfig.from_env(), KnowledgeRepository()
    )

    return {
        "kind": "knowledge_search_result",
        "query": input.query,
        "error": None,
        "sources": sources,
    }
