"""Own embedding clients and a LangChain pgvector store for one async scope."""

import hashlib
import json
import math
import os
from contextlib import asynccontextmanager
from dataclasses import dataclass

from langchain_postgres import PGEngine, PGVectorStore
from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import create_async_engine

from agent_playground.db.connection import postgres_driver_url
from agent_playground.knowledge.embeddings import EmbeddingService
from agent_playground.knowledge.rate_limits import EmbeddingQuota


@dataclass(frozen=True)
class EmbeddingConfig:
    base_url: str
    model: str
    api_key: str
    dimensions: int | None = None
    max_distance: float = 0.55
    batch_size: int = 10
    tokens_per_minute: int = 1_000_000
    requests_per_minute: int = 24_000
    max_retries: int = 5
    index_timeout: int = 600
    quota_scope: str = ""

    @property
    def batch_token_budget(self) -> int:
        # Keep headroom for provider accounting and other account traffic.
        return max(1, int(self.tokens_per_minute * 0.8 / 60))

    @property
    def quota_key(self) -> str:
        identity = json.dumps([self.quota_scope or self.base_url, self.model])

        return hashlib.sha256(identity.encode()).hexdigest()

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
            integer_setting("RAG_EMBEDDING_BATCH_SIZE", 10),
            integer_setting("RAG_EMBEDDING_TPM", 1_000_000),
            integer_setting("RAG_EMBEDDING_RPM", 24_000),
            integer_setting("RAG_EMBEDDING_MAX_RETRIES", 5, minimum=0),
            integer_setting("RAG_INDEX_TIMEOUT_SECONDS", 600),
            os.getenv("RAG_EMBEDDING_QUOTA_SCOPE", ""),
        )

    def profile(self, dimension: int) -> str:
        identity = json.dumps(
            [self.base_url, self.model, self.dimensions], separators=(",", ":")
        )

        return f"{hashlib.sha256(identity.encode()).hexdigest()}:{dimension}"


def integer_setting(name: str, default: int, minimum: int = 1) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError as error:
        raise ValueError(f"{name} must be an integer of at least {minimum}") from error

    if value < minimum:
        raise ValueError(f"{name} must be an integer of at least {minimum}")

    return value


@asynccontextmanager
async def open_store(config: EmbeddingConfig, database_url: str | None = None):
    url = database_url or os.environ["APP_DATABASE_URL"]
    pool = create_async_engine(
        postgres_driver_url(url), connect_args={"connect_timeout": 5}
    )
    engine = PGEngine.from_engine(pool)

    try:
        async with (
            EmbeddingQuota(config) as quota,
            AsyncOpenAI(
                api_key=config.api_key,
                base_url=config.base_url,
                max_retries=0,
                timeout=30,
            ) as client,
        ):
            embeddings = EmbeddingService(config, client, quota)
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
