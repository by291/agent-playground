"""Recoverable indexing with a bounded attempt and generation fencing."""

import asyncio
import hashlib
import logging
import os
from collections.abc import Awaitable, Callable
from uuid import uuid4

import httpx

from agent_playground.config import app_api_url
from agent_playground.db.knowledge import IndexJob, KnowledgeRepository, publish_index
from agent_playground.knowledge.documents import extract_document
from agent_playground.knowledge.embeddings import validate_vectors
from agent_playground.knowledge.store import (
    EmbeddingConfig,
    open_store,
)

logger = logging.getLogger(__name__)


class SupersededIndexJob(Exception):
    """A deleted, expired or replaced generation must stop sending new requests."""


async def index_job(
    job: IndexJob,
    repository: KnowledgeRepository,
    config: EmbeddingConfig,
    source_client: httpx.AsyncClient,
) -> bool:
    async def check_ownership() -> None:
        if not await asyncio.to_thread(repository.renew, job):
            raise SupersededIndexJob

    async def keep_lease() -> None:
        while True:
            await asyncio.sleep(30)
            await check_ownership()

    try:
        async with asyncio.timeout(config.index_timeout):
            await check_ownership()

            async with asyncio.TaskGroup() as tasks:
                heartbeat = tasks.create_task(keep_lease())

                try:
                    return await build_index(
                        job, config, source_client, check_ownership
                    )
                finally:
                    heartbeat.cancel()
    except ExceptionGroup as error:
        _obsolete, remaining = error.split(SupersededIndexJob)

        if remaining:
            if len(remaining.exceptions) == 1:
                raise remaining.exceptions[0] from None

            raise

        logger.info(
            "Stopped obsolete knowledge index: document=%s generation=%s",
            job.id,
            job.generation,
        )

        return False
    except SupersededIndexJob:
        logger.info(
            "Stopped obsolete knowledge index: document=%s generation=%s",
            job.id,
            job.generation,
        )

        return False


async def build_index(
    job: IndexJob,
    config: EmbeddingConfig,
    source_client: httpx.AsyncClient,
    check_ownership: Callable[[], Awaitable[None]],
) -> bool:
    response = await source_client.get(
        f"{app_api_url()}/internal/knowledge/documents/{job.id}/file",
        headers={"Authorization": f"Bearer {os.getenv('WORKFLOW_API_TOKEN', '')}"},
    )
    response.raise_for_status()
    data = response.content

    if len(data) != job.size or hashlib.sha256(data).hexdigest() != job.sha256:
        raise ValueError("Source file does not match its upload metadata")

    documents = await extract_document(job.name, data, text_encoding=job.text_encoding)

    async with open_store(config) as (store, embeddings, pool):
        vectors = await embeddings.aembed_documents(
            [document.page_content for document in documents],
            before_request=check_ownership,
        )
        dimension = validate_vectors(vectors, len(documents))
        profile = config.profile(dimension)
        ids = [str(uuid4()) for _ in documents]
        metadata = [
            dict(
                document.metadata,
                document_id=job.id,
                generation=job.generation,
                embedding_profile=profile,
                visible=False,
            )
            for document in documents
        ]

        try:
            await store.aadd_embeddings(
                [document.page_content for document in documents],
                vectors,
                metadata,
                ids,
            )
            published = await publish_index(pool, job, profile, len(documents))

            return published
        finally:
            # Staged rows remain hidden until the owning generation commits ready.
            await store.adelete(filter={"generation": job.generation, "visible": False})


async def run_knowledge_worker() -> None:
    async with httpx.AsyncClient(timeout=30) as client:
        while True:
            try:
                repository = await asyncio.to_thread(KnowledgeRepository)
                job = await asyncio.to_thread(repository.claim)

                if job:
                    try:
                        await index_job(
                            job, repository, EmbeddingConfig.from_env(), client
                        )
                    except Exception as error:
                        message = indexing_error_message(error)
                        await asyncio.to_thread(repository.fail, job, message)
                        logger.exception(
                            "Knowledge indexing failed for %s: %s",
                            job.id,
                            type(error).__name__,
                        )
            except Exception:
                logger.exception("Knowledge indexing worker will retry")

            await asyncio.sleep(2)


def indexing_error_message(error: Exception) -> str:
    if isinstance(error, ValueError):
        return str(error)

    if isinstance(error, TimeoutError):
        return "Indexing exceeded RAG_INDEX_TIMEOUT_SECONDS while downloading, embedding or saving. Check provider quotas and retry, or increase the indexing deadline."

    return f"Indexing failed ({type(error).__name__}); check the server logs and retry"
