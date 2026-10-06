"""Use real pgvector and the OpenAI embedding adapter with a controlled HTTP API."""

import asyncio
import hashlib
import json
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path
from typing import override
from uuid import uuid4

import httpx
import psycopg
import pytest
from aegra_api.utils.event_loop import selector_loop_factory
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject
from sqlalchemy import create_engine, text
from sqlalchemy.ext.asyncio import create_async_engine

from agent_playground.db.knowledge import KnowledgeRepository, publish_index
from agent_playground.knowledge.documents import split_document
from agent_playground.knowledge.store import EmbeddingConfig, open_store
from agent_playground.knowledge.tools import retrieve
from agent_playground.knowledge.worker import index_job


def create_knowledge_schema(connection: psycopg.Connection) -> None:
    for migration in sorted(Path("server/drizzle").glob("*_knowledge*.sql")):
        connection.execute(migration.read_bytes())


@pytest.fixture
def embedding_requests() -> list[list[str]]:
    return []


@pytest.fixture(autouse=True)
def embedding_environment(embedding_redis_url: str, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("REDIS_URL", embedding_redis_url)


@pytest.fixture
def embedding_api(embedding_requests: list[list[str]]) -> Iterator[str]:
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            assert self.path == "/v1/embeddings"
            assert self.headers["Authorization"] == "Bearer test-key"
            request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            inputs = request["input"]

            if isinstance(inputs, str):
                inputs = [inputs]

            assert all(isinstance(value, str) for value in inputs)
            embedding_requests.append(inputs)

            if request["model"] == "rate-limit-later-batch" and inputs[0] == "later-0":
                attempts = sum(batch[0] == "later-0" for batch in embedding_requests)

                if attempts <= 2:
                    response = json.dumps(
                        {
                            "error": {
                                "message": "Allocated quota exceeded",
                                "type": "insufficient_quota",
                            }
                        }
                    ).encode()
                    self.send_response(429)
                    self.send_header("Retry-After", "0.05")
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(response)))
                    self.end_headers()
                    self.wfile.write(response)

                    return

            if request["model"].startswith("batch-limit-"):
                limit = int(request["model"].removeprefix("batch-limit-"))

                if len(inputs) > limit:
                    response = json.dumps(
                        {
                            "error": {
                                "message": f"batch size should not be larger than {limit}",
                                "type": "invalid_request_error",
                            }
                        }
                    ).encode()
                    self.send_response(400)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(response)))
                    self.end_headers()
                    self.wfile.write(response)

                    return

            vectors = [
                [1.0, 0.1] if "return" in value.lower() else [0.1, 1.0]
                for value in inputs
            ]

            if request["model"] == "new-dimensions":
                vectors = [vector + [0.2] for vector in vectors]

            response = json.dumps(
                {
                    "object": "list",
                    "data": [
                        {"object": "embedding", "index": index, "embedding": vector}
                        for index, vector in enumerate(vectors)
                    ],
                    "model": request["model"],
                    "usage": {"prompt_tokens": 1, "total_tokens": 1},
                }
            ).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(response)))
            self.end_headers()
            self.wfile.write(response)

        @override
        def log_message(self, format: str, *args: object) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever)
    thread.start()

    try:
        yield f"http://127.0.0.1:{server.server_port}/v1"
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def test_index_retrieve_reindex_and_deleted_generation(
    postgres_database_url: str, embedding_api: str, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("APP_DATABASE_URL", postgres_database_url)
    with psycopg.connect(postgres_database_url) as connection:
        create_knowledge_schema(connection)

    engine = create_engine(
        postgres_database_url.replace("postgresql://", "postgresql+psycopg://", 1)
    )
    repository = KnowledgeRepository(engine)
    document_id = str(uuid4())
    data = "Returns are allowed within 30 days. Keep the original receipt. Café policy.".encode(
        "cp1252"
    )
    config = EmbeddingConfig(embedding_api, "test-model", "test-key")

    async def run():
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO knowledge_documents (id,name,size,sha256,object_key,status,text_encoding) VALUES (:id,'policy.md',:size,:sha,'test','queued','cp1252')"
                ),
                {
                    "id": document_id,
                    "size": len(data),
                    "sha": hashlib.sha256(data).hexdigest(),
                },
            )

        job = repository.claim()
        assert job is not None
        assert job.text_encoding == "cp1252"
        assert repository.claim() is None

        async with httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(200, content=data)
            )
        ) as source:
            assert await index_job(job, repository, config, source)
            hits = await retrieve("What is the return policy?", config, repository)
            assert hits[0]["documentId"] == document_id
            assert hits[0]["name"] == "policy.md"
            assert (
                hits[0]["citation"]
                == f"[source](#knowledge-source-{hits[0]['chunkId']})"
            )
            assert "30 days" in str(hits[0]["excerpt"])
            assert "Café policy" in str(hits[0]["excerpt"])
            assert await retrieve("unrelated astronomy", config, repository) == []
            assert (
                await retrieve(
                    "returns",
                    EmbeddingConfig(embedding_api, "other-model", "test-key"),
                    repository,
                )
                == []
            )
            assert (
                await retrieve(
                    "returns",
                    EmbeddingConfig(embedding_api, "new-dimensions", "test-key"),
                    repository,
                )
                == []
            )

            with engine.begin() as connection:
                connection.execute(
                    text(
                        "UPDATE knowledge_documents SET status='queued',generation=NULL"
                    )
                )
                connection.execute(text("UPDATE knowledge_chunks SET visible=false"))

            old = repository.claim()
            assert old is not None
            with engine.begin() as connection:
                connection.execute(
                    text(
                        "UPDATE knowledge_documents SET lease_until=now()-interval '1 second'"
                    )
                )

            recovered = repository.claim()
            assert recovered is not None and recovered.generation != old.generation
            assert not await index_job(old, repository, config, source)
            assert await retrieve("returns", config, repository) == []
            assert await index_job(recovered, repository, config, source)
            assert len(await retrieve("returns", config, repository)) == 1

            with engine.begin() as connection:
                connection.execute(
                    text(
                        "UPDATE knowledge_documents SET status='queued',generation=NULL"
                    )
                )
                connection.execute(text("UPDATE knowledge_chunks SET visible=false"))

            cancelled_job = repository.claim()
            assert cancelled_job is not None
            pool = create_async_engine(
                postgres_database_url.replace(
                    "postgresql://", "postgresql+psycopg://", 1
                )
            )
            locker = engine.connect()
            transaction = locker.begin()
            locker.execute(
                text("DELETE FROM knowledge_chunks WHERE generation <> :generation"),
                {"generation": cancelled_job.generation},
            )
            with engine.begin() as connection:
                connection.execute(
                    text(
                        "INSERT INTO knowledge_chunks (langchain_id,document_id,generation,embedding_profile,content,embedding) VALUES (:id,:document,:generation,:profile,'returns','[1,0.1]')"
                    ),
                    {
                        "id": str(uuid4()),
                        "document": document_id,
                        "generation": cancelled_job.generation,
                        "profile": config.profile(2),
                    },
                )

            publishing = asyncio.create_task(
                publish_index(pool, cancelled_job, config.profile(2), 1)
            )

            try:
                await asyncio.sleep(0.1)
                assert not publishing.done()
                publishing.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await publishing
            finally:
                transaction.rollback()
                locker.close()
                await pool.dispose()

            with engine.connect() as connection:
                assert (
                    connection.execute(
                        text("SELECT status FROM knowledge_documents")
                    ).scalar_one()
                    == "indexing"
                )

            repository.fail(cancelled_job, "cancelled")
            with engine.begin() as connection:
                connection.execute(
                    text("UPDATE knowledge_documents SET status='queued'")
                )

            successful = repository.claim()
            assert successful is not None
            assert await index_job(successful, repository, config, source)

            with engine.begin() as connection:
                connection.execute(
                    text(
                        "UPDATE knowledge_documents SET deleted_at=now(),generation=NULL"
                    )
                )
                connection.execute(text("UPDATE knowledge_chunks SET visible=false"))

            assert await retrieve("returns", config, repository) == []
            assert not await index_job(recovered, repository, config, source)
            repository.fail(old, "late failure")
            with engine.connect() as connection:
                assert (
                    connection.execute(
                        text("SELECT status FROM knowledge_documents")
                    ).scalar_one()
                    == "ready"
                )

    try:
        asyncio.run(run(), loop_factory=selector_loop_factory)
    finally:
        engine.dispose()


def test_empty_pdf_is_actionable():
    pdf = PdfWriter()
    pdf.add_blank_page(width=100, height=100)
    output = BytesIO()
    pdf.write(output)

    with pytest.raises(ValueError, match="OCR"):
        split_document("scan.pdf", output.getvalue())


@pytest.mark.parametrize("batch_size,limit", [(None, 20), ("7", 7)])
def test_embedding_requests_respect_provider_batch_limits(
    postgres_database_url: str,
    embedding_api: str,
    monkeypatch: pytest.MonkeyPatch,
    batch_size: str | None,
    limit: int,
):
    monkeypatch.setenv("RAG_EMBEDDING_BASE_URL", embedding_api)
    monkeypatch.setenv("RAG_EMBEDDING_MODEL", f"batch-limit-{limit}")
    monkeypatch.setenv("RAG_EMBEDDING_API_KEY", "test-key")

    if batch_size:
        monkeypatch.setenv("RAG_EMBEDDING_BATCH_SIZE", batch_size)
    else:
        monkeypatch.delenv("RAG_EMBEDDING_BATCH_SIZE", raising=False)

    with psycopg.connect(postgres_database_url) as connection:
        create_knowledge_schema(connection)

    texts = [
        f"return {index}" if index % 2 == 0 else f"receipt {index}"
        for index in range(45)
    ]

    async def run():
        async with open_store(EmbeddingConfig.from_env(), postgres_database_url) as (
            _store,
            embeddings,
            _pool,
        ):
            vectors = await embeddings.aembed_documents(texts)

            assert vectors == [
                [1.0, 0.1] if index % 2 == 0 else [0.1, 1.0] for index in range(45)
            ]

    asyncio.run(run(), loop_factory=selector_loop_factory)


def test_pdf_chunks_preserve_real_text_and_page_numbers():
    pdf = PdfWriter()
    font = pdf._add_object(
        DictionaryObject(
            {
                NameObject("/Type"): NameObject("/Font"),
                NameObject("/Subtype"): NameObject("/Type1"),
                NameObject("/BaseFont"): NameObject("/Helvetica"),
            }
        )
    )

    for content in [b"Returns within 30 days.", b"Keep the receipt."]:
        page = pdf.add_blank_page(width=200, height=200)
        page[NameObject("/Resources")] = DictionaryObject(
            {NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})}
        )
        stream = DecodedStreamObject()
        stream.set_data(b"BT /F1 12 Tf 20 50 Td (" + content + b") Tj ET")
        page[NameObject("/Contents")] = pdf._add_object(stream)

    output = BytesIO()
    pdf.write(output)
    chunks = split_document("policy.pdf", output.getvalue())

    assert [chunk.metadata["page"] for chunk in chunks] == [1, 2]
    assert chunks[0].page_content == "Returns within 30 days."
    assert chunks[1].page_content == "Keep the receipt."


def test_rate_limited_batch_recovers_without_resending_successful_texts(
    postgres_database_url: str,
    embedding_api: str,
    embedding_requests: list[list[str]],
):
    with psycopg.connect(postgres_database_url) as connection:
        create_knowledge_schema(connection)

    config = EmbeddingConfig(
        embedding_api, "rate-limit-later-batch", "test-key", batch_size=2
    )

    async def run():
        async with open_store(config, postgres_database_url) as (
            _store,
            embeddings,
            _pool,
        ):
            vectors = await embeddings.aembed_documents(
                ["first-0", "first-1", "later-0", "later-1"]
            )

            assert len(vectors) == 4

    asyncio.run(run(), loop_factory=selector_loop_factory)

    assert embedding_requests == [
        ["first-0", "first-1"],
        ["later-0", "later-1"],
        ["later-0", "later-1"],
        ["later-0", "later-1"],
    ]


def test_deleted_document_stops_embedding_after_its_source_download(
    postgres_database_url: str,
    embedding_api: str,
    embedding_requests: list[list[str]],
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv("APP_DATABASE_URL", postgres_database_url)
    data = b"Returns within 30 days."
    document_id = str(uuid4())

    with psycopg.connect(postgres_database_url) as connection:
        create_knowledge_schema(connection)
        connection.execute(
            "INSERT INTO knowledge_documents (id,name,size,sha256,object_key,status) VALUES (%s,'policy.md',%s,%s,'test','queued')",
            (document_id, len(data), hashlib.sha256(data).hexdigest()),
        )

    engine = create_engine(
        postgres_database_url.replace("postgresql://", "postgresql+psycopg://", 1)
    )
    repository = KnowledgeRepository(engine)
    job = repository.claim()
    assert job is not None

    def download(_request: httpx.Request):
        with engine.begin() as connection:
            connection.execute(
                text("UPDATE knowledge_documents SET deleted_at=now(),generation=NULL")
            )

        return httpx.Response(200, content=data)

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(download)) as source:
            assert not await index_job(
                job,
                repository,
                EmbeddingConfig(embedding_api, "deleted", "test-key"),
                source,
            )

    try:
        asyncio.run(run(), loop_factory=selector_loop_factory)
        assert embedding_requests == []
    finally:
        engine.dispose()


def test_index_deadline_includes_slow_source_download(
    postgres_database_url: str,
    embedding_api: str,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv("APP_DATABASE_URL", postgres_database_url)
    data = b"Returns within 30 days."

    with psycopg.connect(postgres_database_url) as connection:
        create_knowledge_schema(connection)
        connection.execute(
            "INSERT INTO knowledge_documents (id,name,size,sha256,object_key,status) VALUES (%s,'policy.md',%s,%s,'test','queued')",
            (str(uuid4()), len(data), hashlib.sha256(data).hexdigest()),
        )

    engine = create_engine(
        postgres_database_url.replace("postgresql://", "postgresql+psycopg://", 1)
    )
    repository = KnowledgeRepository(engine)
    job = repository.claim()
    assert job is not None

    async def download(_request: httpx.Request):
        await asyncio.sleep(2)

        return httpx.Response(200, content=data)

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(download)) as source:
            with pytest.raises(TimeoutError):
                await index_job(
                    job,
                    repository,
                    EmbeddingConfig(
                        embedding_api, "deadline", "test-key", index_timeout=1
                    ),
                    source,
                )

    try:
        asyncio.run(run(), loop_factory=selector_loop_factory)
    finally:
        engine.dispose()
