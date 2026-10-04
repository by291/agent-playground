"""Recoverable indexing with a bounded attempt and generation fencing."""

import asyncio
import hashlib
import logging
import os
from uuid import uuid4

import httpx

from agent_playground.config import app_api_url
from agent_playground.db.knowledge import IndexJob, KnowledgeRepository, publish_index
from agent_playground.knowledge.documents import extract_document
from agent_playground.knowledge.store import (
    EmbeddingConfig,
    open_store,
    validate_vectors,
)

logger = logging.getLogger(__name__)


async def index_job(
    job: IndexJob,
    repository: KnowledgeRepository,
    config: EmbeddingConfig,
    source_client: httpx.AsyncClient,
) -> bool:
    async with asyncio.timeout(120):
        response = await source_client.get(
            f"{app_api_url()}/internal/knowledge/documents/{job.id}/file",
            headers={"Authorization": f"Bearer {os.getenv('WORKFLOW_API_TOKEN', '')}"},
        )
        response.raise_for_status()
        data = response.content

        if len(data) != job.size or hashlib.sha256(data).hexdigest() != job.sha256:
            raise ValueError("Source file does not match its upload metadata")

        documents = await extract_document(job.name, data)

        async with open_store(config) as (store, embeddings, pool):
            vectors = await embeddings.aembed_documents(
                [document.page_content for document in documents]
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
                await store.adelete(
                    filter={"generation": job.generation, "visible": False}
                )


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
                        message = (
                            str(error)
                            if isinstance(error, ValueError)
                            else f"Indexing failed ({type(error).__name__}); check the embedding service and retry"
                        )
                        await asyncio.to_thread(repository.fail, job, message)
                        logger.exception(
                            "Knowledge indexing failed for %s: %s",
                            job.id,
                            type(error).__name__,
                        )
            except Exception:
                logger.exception("Knowledge indexing worker will retry")

            await asyncio.sleep(2)
