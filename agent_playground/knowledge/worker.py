"""Recoverable indexing with a bounded attempt and generation fencing."""

import asyncio
import hashlib
import logging
from dataclasses import dataclass
from uuid import uuid4

import httpx

from agent_playground.config.agent import app_api_url, workflow_api_token
from agent_playground.db.async_operations import run_database_operation
from agent_playground.db.knowledge import (
    IndexJob,
    IndexPublication,
    KnowledgeRepository,
    publish_index,
)
from agent_playground.knowledge.config import EmbeddingConfig
from agent_playground.knowledge.documents import extract_document
from agent_playground.knowledge.embeddings import validate_vectors
from agent_playground.knowledge.store import open_store

logger = logging.getLogger(__name__)
LEASE_RENEWAL_SECONDS = 30
SOURCE_DOWNLOAD_TIMEOUT_SECONDS = 30
JOB_POLL_SECONDS = 2


class SupersededIndexJob(Exception):
    """A deleted, expired or replaced generation must stop sending new requests."""


@dataclass(frozen=True, kw_only=True)
class IndexAttempt:
    """Bind a claimed generation to its repository, configuration and source client."""

    job: IndexJob
    repository: KnowledgeRepository
    config: EmbeddingConfig
    source_client: httpx.AsyncClient

    async def check_ownership(self) -> None:
        """Renew the lease or cancel work for a stale generation."""
        if not await run_database_operation(self.repository.renew, self.job):
            raise SupersededIndexJob


async def _keep_lease(attempt: IndexAttempt) -> None:
    while True:
        await asyncio.sleep(LEASE_RENEWAL_SECONDS)
        await attempt.check_ownership()


async def _build_index_with_lease(attempt: IndexAttempt) -> bool:
    await attempt.check_ownership()

    async with asyncio.TaskGroup() as tasks:
        # A failed ownership check cancels indexing; completion stops renewal.
        heartbeat = tasks.create_task(_keep_lease(attempt))

        try:
            return await build_index(attempt)
        finally:
            heartbeat.cancel()


async def index_job(attempt: IndexAttempt) -> bool:
    """Index one claimed generation before its deadline while renewing the lease."""
    try:
        async with asyncio.timeout(attempt.config.index_timeout):
            return await _build_index_with_lease(attempt)
    except ExceptionGroup as error:
        _obsolete, remaining = error.split(SupersededIndexJob)

        if remaining:
            # Surface the original failure when the task group contains only one.
            if len(remaining.exceptions) == 1:
                raise remaining.exceptions[0] from None

            raise
    except SupersededIndexJob:
        # The first lease check runs before the sibling renewal task starts.
        pass

    logger.info(
        "Stopped obsolete knowledge index: document=%s generation=%s",
        attempt.job.id,
        attempt.job.generation,
    )

    return False


async def build_index(attempt: IndexAttempt) -> bool:
    """Stage hidden vectors and publish only if the claimed generation owns them."""
    job = attempt.job
    config = attempt.config

    response = await attempt.source_client.get(
        f"{app_api_url()}/internal/knowledge/documents/{job.id}/file",
        headers={"Authorization": f"Bearer {workflow_api_token()}"},
    )
    response.raise_for_status()
    source_bytes = response.content

    has_source_mismatch = (
        len(source_bytes) != job.size
        or hashlib.sha256(source_bytes).hexdigest() != job.sha256
    )

    if has_source_mismatch:
        raise ValueError("Source file does not match its upload metadata")

    documents = await extract_document(
        job.name, source_bytes, text_encoding=job.text_encoding
    )
    texts = [document.page_content for document in documents]

    async with open_store(config) as (store, embeddings, pool):
        vectors = await embeddings.aembed_documents(
            texts,
            before_request=attempt.check_ownership,
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
                texts=texts, embeddings=vectors, metadatas=metadata, ids=ids
            )

            return await publish_index(
                IndexPublication(
                    engine=pool, job=job, profile=profile, chunk_count=len(documents)
                )
            )
        finally:
            # Staged rows remain hidden until the owning generation commits ready.
            await store.adelete(filter={"generation": job.generation, "visible": False})


async def _run_next_job(client: httpx.AsyncClient) -> None:
    repository = await run_database_operation(KnowledgeRepository)
    job = await run_database_operation(repository.claim)

    if job is None:
        return

    try:
        config = EmbeddingConfig.from_config()
        await index_job(
            IndexAttempt(
                job=job, repository=repository, config=config, source_client=client
            )
        )
    except Exception as error:
        message = indexing_error_message(error)

        # Only this generation may be marked failed; a later claim can take over.
        await run_database_operation(repository.fail, job, message)
        logger.exception(
            "Knowledge indexing failed for %s: %s",
            job.id,
            type(error).__name__,
        )


async def run_knowledge_worker() -> None:
    """Claim recoverable jobs until application shutdown cancels the worker."""
    async with httpx.AsyncClient(timeout=SOURCE_DOWNLOAD_TIMEOUT_SECONDS) as client:
        while True:
            try:
                await _run_next_job(client)
            except Exception:
                logger.exception("Knowledge indexing worker will retry")

            await asyncio.sleep(JOB_POLL_SECONDS)


def indexing_error_message(error: Exception) -> str:
    """Convert indexing failures to messages safe to show in document status."""
    if isinstance(error, ValueError):
        return str(error)

    if isinstance(error, TimeoutError):
        return "Indexing exceeded RAG_INDEX_TIMEOUT_SECONDS while downloading, embedding or saving. Check provider quotas and retry, or increase the indexing deadline."

    return f"Indexing failed ({type(error).__name__}); check the server logs and retry"
