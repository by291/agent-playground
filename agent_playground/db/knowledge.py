"""Claim durable indexing jobs and publish only the current generation.

Document and chunk DDL is owned by the TypeScript application's migrations.
"""

from dataclasses import dataclass
from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.ext.asyncio import AsyncEngine

from agent_playground.db.connection import app_engine


@dataclass(frozen=True)
class IndexJob:
    id: str
    name: str
    size: int
    sha256: str
    generation: str
    text_encoding: str | None = None


class KnowledgeRepository:
    def __init__(self, engine: Engine | None = None):
        self.engine = engine or app_engine()

    def claim(self) -> IndexJob | None:
        with self.engine.begin() as connection:
            row = (
                connection.execute(
                    text("""
                SELECT id, name, size, sha256, text_encoding FROM knowledge_documents
                WHERE deleted_at IS NULL AND
                  (status = 'queued' OR (status = 'indexing' AND lease_until < now()))
                ORDER BY updated_at, id FOR UPDATE SKIP LOCKED LIMIT 1
            """)
                )
                .mappings()
                .first()
            )

            if row is None:
                return None

            generation = str(uuid4())
            connection.execute(
                text("""
                UPDATE knowledge_documents SET status = 'indexing', generation = :generation,
                  lease_until = now() + interval '3 minutes', updated_at = now(), error = NULL
                WHERE id = :id
            """),
                {"id": row["id"], "generation": generation},
            )

            return IndexJob(
                str(row["id"]),
                str(row["name"]),
                int(row["size"]),
                str(row["sha256"]),
                generation,
                row["text_encoding"],
            )

    def fail(self, job: IndexJob, message: str) -> None:
        with self.engine.begin() as connection:
            connection.execute(
                text("""
                UPDATE knowledge_documents SET status = 'failed', lease_until = NULL,
                  error = :error, updated_at = now()
                WHERE id = :id AND generation = :generation AND deleted_at IS NULL AND status = 'indexing'
            """),
                {"id": job.id, "generation": job.generation, "error": message[:500]},
            )
            connection.execute(
                text(
                    "DELETE FROM knowledge_chunks WHERE document_id = :id AND generation = :generation AND visible = false"
                ),
                {"id": job.id, "generation": job.generation},
            )

    def renew(self, job: IndexJob) -> bool:
        with self.engine.begin() as connection:
            result = connection.execute(
                text("""
                UPDATE knowledge_documents SET lease_until = now() + interval '3 minutes'
                WHERE id = :id AND generation = :generation AND deleted_at IS NULL
                  AND status = 'indexing' AND lease_until > now()
                RETURNING id
            """),
                {"id": job.id, "generation": job.generation},
            )

            return result.first() is not None

    def visible_ids(self, profile: str, ids: list[str]) -> set[str]:
        with self.engine.connect() as connection:
            rows = connection.execute(
                text("""
                SELECT c.langchain_id FROM knowledge_chunks c JOIN knowledge_documents d ON d.id = c.document_id
                WHERE c.visible AND c.embedding_profile = :profile AND d.deleted_at IS NULL
                  AND d.status = 'ready' AND d.generation = c.generation
                  AND c.langchain_id = ANY(:ids)
            """),
                {"profile": profile, "ids": ids},
            )

            return {str(row[0]) for row in rows}


async def publish_index(
    engine: AsyncEngine, job: IndexJob, profile: str, chunk_count: int
) -> bool:
    async with engine.begin() as connection:
        result = await connection.execute(
            text("""
            SELECT id FROM knowledge_documents WHERE id = :id AND generation = :generation
              AND status = 'indexing' AND deleted_at IS NULL AND lease_until > now()
            FOR UPDATE
        """),
            {"id": job.id, "generation": job.generation},
        )
        current = result.first()

        if current is None:
            return False

        await connection.execute(
            text(
                "DELETE FROM knowledge_chunks WHERE document_id = :id AND generation <> :generation"
            ),
            {"id": job.id, "generation": job.generation},
        )
        await connection.execute(
            text(
                "UPDATE knowledge_chunks SET visible = true WHERE document_id = :id AND generation = :generation"
            ),
            {"id": job.id, "generation": job.generation},
        )
        await connection.execute(
            text("""
            UPDATE knowledge_documents SET status = 'ready', lease_until = NULL,
              embedding_profile = :profile, chunk_count = :count, error = NULL, updated_at = now()
            WHERE id = :id
        """),
            {"id": job.id, "profile": profile, "count": chunk_count},
        )

        return True
