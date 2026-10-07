"""Own embedding clients and a LangChain pgvector store for one async scope."""

import hashlib
import json
from contextlib import asynccontextmanager
from dataclasses import dataclass, field

from langchain_postgres import PGEngine, PGVectorStore
from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import create_async_engine

from agent_playground.config import load_agent_config, load_model_config
from agent_playground.db.connection import postgres_driver_url
from agent_playground.knowledge.embeddings import EmbeddingService
from agent_playground.knowledge.rate_limits import EmbeddingQuota


@dataclass(frozen=True)
class EmbeddingConfig:
    base_url: str
    model: str
    api_key: str = field(repr=False)
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
    def from_config(cls) -> "EmbeddingConfig":
        settings = load_model_config().embedding
        api_key = settings.api_key.get_secret_value()

        if not api_key.strip() or not settings.model:
            raise ValueError(
                "Configure embedding.api_key and embedding.model in models.yaml, then retry indexing"
            )

        return cls(
            settings.base_url.rstrip("/"),
            settings.model,
            api_key,
            settings.dimensions,
            settings.max_distance,
            settings.batch_size,
            settings.tokens_per_minute,
            settings.requests_per_minute,
            settings.max_retries,
            settings.index_timeout,
            settings.quota_scope,
        )

    def profile(self, dimension: int) -> str:
        identity = json.dumps(
            [self.base_url, self.model, self.dimensions], separators=(",", ":")
        )

        return f"{hashlib.sha256(identity.encode()).hexdigest()}:{dimension}"


@asynccontextmanager
async def open_store(config: EmbeddingConfig, database_url: str | None = None):
    url = (
        database_url or load_agent_config().database.application_url.get_secret_value()
    )
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
