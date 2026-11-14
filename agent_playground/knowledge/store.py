"""Own embedding clients and a LangChain pgvector store for one async scope."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from langchain_postgres import PGEngine, PGVectorStore
from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from agent_playground.config.agent import load_agent_config
from agent_playground.db.connection import postgres_driver_url
from agent_playground.knowledge.config import EmbeddingConfig
from agent_playground.knowledge.embeddings import EmbeddingService
from agent_playground.knowledge.rate_limits import EmbeddingQuota

DATABASE_CONNECT_TIMEOUT_SECONDS = 5
EMBEDDING_REQUEST_TIMEOUT_SECONDS = 30


@asynccontextmanager
async def open_store(
    config: EmbeddingConfig, database_url: str | None = None
) -> AsyncIterator[tuple[PGVectorStore, EmbeddingService, AsyncEngine]]:
    """Lend the store and its clients while retaining ownership of their cleanup."""
    if not database_url:
        database_settings = load_agent_config().database
        database_url = database_settings.application_url.get_secret_value()

    pool = create_async_engine(
        postgres_driver_url(database_url),
        connect_args={"connect_timeout": DATABASE_CONNECT_TIMEOUT_SECONDS},
    )
    engine = PGEngine.from_engine(pool)

    try:
        async with (
            EmbeddingQuota(config) as quota,
            AsyncOpenAI(
                api_key=config.api_key,
                base_url=config.base_url,
                max_retries=0,
                timeout=EMBEDDING_REQUEST_TIMEOUT_SECONDS,
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

            yield (
                store,
                embeddings,
                pool,
            )
    finally:
        # PGEngine owns disposal of the underlying pool.
        await engine.close()
