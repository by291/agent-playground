"""Shared knowledge extraction and indexing behavior."""

import asyncio
import sys

import pytest

from agent_playground.knowledge import documents
from agent_playground.knowledge.documents import split_document


def test_document_chunks_keep_source_pages_and_reject_empty_content():
    import pytest

    chunks = split_document(
        "guide.md", b"# Policy\nReturns are allowed within 30 days."
    )
    assert chunks[0].page_content.startswith("# Policy")
    assert chunks[0].metadata["page"] is None
    with pytest.raises(ValueError, match="text"):
        split_document("empty.txt", b"   ")
    with pytest.raises(ValueError, match="UTF-8"):
        split_document("invalid.txt", b"\xff")


def test_cancelled_extraction_terminates_its_process(monkeypatch: pytest.MonkeyPatch):
    async def run():
        spawn = asyncio.create_subprocess_exec
        started = asyncio.Event()
        child: asyncio.subprocess.Process | None = None

        async def slow_extraction(*_args: object, **kwargs: object):
            nonlocal child
            child = await spawn(
                sys.executable,
                "-c",
                'import sys,time; sys.stdout.write("x"*1_000_000); sys.stdout.flush(); time.sleep(60)',
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            await asyncio.sleep(0.1)
            started.set()

            return child

        monkeypatch.setattr(
            documents.asyncio, "create_subprocess_exec", slow_extraction
        )
        task = asyncio.create_task(documents.extract_document("policy.md", b"returns"))
        await started.wait()
        task.cancel()

        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(task, timeout=2)

        assert child is not None and child.returncode is not None

    asyncio.run(run())
