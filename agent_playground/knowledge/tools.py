"""Return bounded retrieved excerpts as persistent ordinary tool messages."""

import asyncio
import json
import logging
import math

from langchain.tools import ToolRuntime, tool
from langchain_core.messages import ToolMessage

from agent_playground.db.knowledge import KnowledgeRepository
from agent_playground.knowledge.config import EmbeddingConfig
from agent_playground.knowledge.embeddings import validate_vectors
from agent_playground.knowledge.store import open_store


async def retrieve(
    query: str, config: EmbeddingConfig, repository: KnowledgeRepository
) -> list[dict[str, object]]:
    """Retrieve bounded excerpts and recheck generation visibility before returning."""
    if not query.strip() or len(query) > 2000:
        raise ValueError("Use a nonempty search query up to 2000 characters")

    async with asyncio.timeout(45):
        async with open_store(config) as (store, embeddings, _pool):
            vector = await embeddings.aembed_query(query)
            profile = config.profile(validate_vectors([vector], 1))
            matches = await store.asimilarity_search_with_score_by_vector(
                vector, k=5, filter={"embedding_profile": profile, "visible": True}
            )

            # A document can be replaced or deleted after similarity search. The
            # repository checks readiness and the owning generation before citation.
            visible = await asyncio.to_thread(
                repository.visible_ids,
                profile,
                [document.id for document, _ in matches if document.id],
            )

            return [
                {
                    "chunkId": document.id,
                    "documentId": document.metadata["document_id"],
                    "name": document.metadata["name"],
                    "page": document.metadata.get("page"),
                    "excerpt": document.page_content,
                    "distance": float(distance),
                    "citation": f"[source](#knowledge-source-{document.id})",
                }
                for document, distance in matches
                if document.id in visible
                and math.isfinite(distance)
                and distance <= config.max_distance
            ]


@tool
async def search_knowledge(query: str, runtime: ToolRuntime) -> ToolMessage:
    """Search the shared uploaded knowledge documents. Return source names, pages, excerpts and citation links. Copy each source's citation link after the claim supported by that excerpt. Empty results mean no matching evidence in the current embedding index."""
    payload: dict[str, object] = {
        "kind": "knowledge_search_result",
        "query": query,
        "sources": [],
        "error": None,
    }

    try:
        config = EmbeddingConfig.from_config()
        repository = await asyncio.to_thread(KnowledgeRepository)
        payload["sources"] = await retrieve(query, config, repository)
    except ValueError as error:
        payload["error"] = str(error)
    except TimeoutError:
        payload["error"] = (
            "Knowledge search timed out while waiting for embeddings or retrieval. Wait before retrying and check provider quotas."
        )
    except Exception as error:
        logging.getLogger(__name__).exception(
            "Knowledge retrieval failed: %s", type(error).__name__
        )
        payload["error"] = (
            "Knowledge retrieval is unavailable. Check the embedding configuration and document index status."
        )

    return ToolMessage(
        content=json.dumps(payload, ensure_ascii=False),
        tool_call_id=runtime.tool_call_id or "",
        name="search_knowledge",
    )
