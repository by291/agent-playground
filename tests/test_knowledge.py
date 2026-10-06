"""Shared knowledge extraction and indexing behavior."""

import asyncio
import subprocess
import sys
import threading
from collections.abc import Callable

import pytest
from aegra_api.utils.event_loop import selector_loop_factory

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


def test_extraction_supports_the_database_compatible_event_loop():
    chunks = asyncio.run(
        documents.extract_document("policy.md", b"Returns are allowed within 30 days."),
        loop_factory=selector_loop_factory,
    )

    assert len(chunks) == 1
    assert chunks[0].page_content == "Returns are allowed within 30 days."
    assert chunks[0].metadata == {"name": "policy.md", "page": None}


@pytest.mark.parametrize("loop_factory", [None, selector_loop_factory])
@pytest.mark.parametrize("cancel_during_start", [False, True])
def test_cancelled_extraction_terminates_its_process(
    monkeypatch: pytest.MonkeyPatch,
    loop_factory: Callable[[], asyncio.AbstractEventLoop] | None,
    cancel_during_start: bool,
):
    async def run():
        spawn = subprocess.Popen
        loop = asyncio.get_running_loop()
        started = asyncio.Event()
        release_start = threading.Event()
        child: subprocess.Popen[bytes] | None = None

        def slow_extraction(*_args: object, **_kwargs: object):
            nonlocal child
            child = spawn(
                [
                    sys.executable,
                    "-c",
                    'import sys,time; sys.stdout.write("x"*1_000_000); sys.stdout.flush(); time.sleep(60)',
                ],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                creationflags=subprocess.CREATE_NO_WINDOW
                if sys.platform == "win32"
                else 0,
            )
            loop.call_soon_threadsafe(started.set)

            if cancel_during_start:
                assert release_start.wait(timeout=5)

            return child

        monkeypatch.setattr(documents.subprocess, "Popen", slow_extraction)
        task = asyncio.create_task(documents.extract_document("policy.md", b"returns"))
        await started.wait()

        try:
            if not cancel_during_start:
                await asyncio.sleep(0.1)

            task.cancel()
            release_start.set()

            with pytest.raises(asyncio.CancelledError):
                await asyncio.wait_for(task, timeout=2)

            assert child is not None and child.poll() is not None
        finally:
            release_start.set()

            if child is not None and child.poll() is None:
                child.kill()
                await asyncio.to_thread(child.communicate)

    asyncio.run(run(), loop_factory=loop_factory)
