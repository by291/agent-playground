"""Own embedding clients and a LangChain pgvector store for one async scope."""

import hashlib
import json
import math
import os
from contextlib import asynccontextmanager
from dataclasses import dataclass

import httpx
from langchain_openai import OpenAIEmbeddings
from langchain_postgres import PGEngine, PGVectorStore
from sqlalchemy.ext.asyncio import create_async_engine

from agent_playground.db.connection import postgres_driver_url


@dataclass(frozen=True)
class EmbeddingConfig:
    base_url: str
    model: str
    api_key: str
    dimensions: int | None = None
    max_distance: float = 0.55
    batch_size: int = 10

    @classmethod
    def from_env(cls) -> "EmbeddingConfig":
        api_key = os.getenv("RAG_EMBEDDING_API_KEY", "")
        model = os.getenv("RAG_EMBEDDING_MODEL", "")

        if not api_key or not model:
            raise ValueError(
                "Configure RAG_EMBEDDING_API_KEY and RAG_EMBEDDING_MODEL, then retry indexing"
            )

        dimensions = os.getenv("RAG_EMBEDDING_DIMENSIONS", "")
        distance = float(os.getenv("RAG_MAX_DISTANCE", "0.55"))

        try:
            batch_size = int(os.getenv("RAG_EMBEDDING_BATCH_SIZE", "10"))
        except ValueError as error:
            raise ValueError(
                "RAG_EMBEDDING_BATCH_SIZE must be a positive integer"
            ) from error

        if batch_size < 1:
            raise ValueError("RAG_EMBEDDING_BATCH_SIZE must be a positive integer")

        if not math.isfinite(distance) or not 0 <= distance <= 2:
            raise ValueError("RAG_MAX_DISTANCE must be between 0 and 2")

        return cls(
            os.getenv("RAG_EMBEDDING_BASE_URL", "https://api.openai.com/v1").rstrip(
                "/"
            ),
            model,
            api_key,
            int(dimensions) if dimensions else None,
            distance,
            batch_size,
        )

    def profile(self, dimension: int) -> str:
        identity = json.dumps(
            [self.base_url, self.model, self.dimensions], separators=(",", ":")
        )

        return f"{hashlib.sha256(identity.encode()).hexdigest()}:{dimension}"


def validate_vectors(vectors: list[list[float]], count: int) -> int:
    if len(vectors) != count or not vectors:
        raise ValueError("Embedding API returned an unexpected number of vectors")

    dimension = len(vectors[0])

    if not dimension or any(
        len(vector) != dimension
        or not all(math.isfinite(value) for value in vector)
        or not any(vector)
        for vector in vectors
    ):
        raise ValueError("Embedding API returned invalid vectors")

    return dimension


@asynccontextmanager
async def open_store(config: EmbeddingConfig, database_url: str | None = None):
    url = database_url or os.environ["APP_DATABASE_URL"]
    pool = create_async_engine(
        postgres_driver_url(url), connect_args={"connect_timeout": 5}
    )
    engine = PGEngine.from_engine(pool)

    try:
        async with httpx.AsyncClient(timeout=30) as async_client:
            with httpx.Client(timeout=30) as sync_client:
                embeddings = OpenAIEmbeddings(
                    api_key=config.api_key,
                    base_url=config.base_url,
                    model=config.model,
                    dimensions=config.dimensions,
                    check_embedding_ctx_length=False,
                    chunk_size=config.batch_size,
                    request_timeout=30,
                    max_retries=1,
                    http_client=sync_client,
                    http_async_client=async_client,
                )
                store = await PGVectorStore.create(
                    engine=engine,
                    embedding_service=embeddings,
                    table_name="knowledge_chunks",
                    metadata_columns=[
                        "document_id",
                        "generation",
                        "embedding_profile",
                        "visible",
                    ],
                )

                yield store, embeddings, pool
    finally:
        await engine.close()
