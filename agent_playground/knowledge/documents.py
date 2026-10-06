"""Extract text with source pages and split it using LangChain's splitter."""

import asyncio
import json
import subprocess
import sys
from contextlib import suppress
from io import BytesIO
from pathlib import Path

from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from pypdf import PdfReader

from agent_playground.knowledge.text import decode_text


def split_document(
    name: str, data: bytes, *, text_encoding: str | None = None
) -> list[Document]:
    suffix = Path(name).suffix.lower()

    if suffix == ".pdf":
        if text_encoding is not None:
            raise ValueError("Text encoding applies only to TXT and Markdown files")

        reader = PdfReader(BytesIO(data))

        if reader.is_encrypted or len(reader.pages) > 200:
            raise ValueError("Use an unencrypted PDF with at most 200 pages")

        documents = [
            Document(
                page_content=page.extract_text() or "",
                metadata={"name": name, "page": index + 1},
            )
            for index, page in enumerate(reader.pages)
        ]
    elif suffix in {".txt", ".md"}:
        content = decode_text(data, text_encoding)

        documents = [
            Document(page_content=content, metadata={"name": name, "page": None})
        ]
    else:
        raise ValueError("Use a TXT, Markdown or PDF document")

    documents = [document for document in documents if document.page_content.strip()]

    if not documents:
        raise ValueError("No extractable text. Scanned PDFs require OCR before upload")

    if sum(len(document.page_content) for document in documents) > 2_000_000:
        raise ValueError("Extracted text exceeds two million characters")

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=1200, chunk_overlap=150, separators=["\n\n", "\n", "。", " ", ""]
    )

    return splitter.split_documents(documents)


async def extract_document(
    name: str, data: bytes, *, text_encoding: str | None = None
) -> list[Document]:
    # Windows' database-compatible Selector loop cannot manage asyncio subprocesses.
    starting = asyncio.create_task(
        asyncio.to_thread(
            lambda: subprocess.Popen(
                [
                    sys.executable,
                    "-m",
                    "agent_playground.knowledge.documents",
                    name,
                    text_encoding if text_encoding is not None else "auto",
                ],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                creationflags=subprocess.CREATE_NO_WINDOW
                if sys.platform == "win32"
                else 0,
            ),
        )
    )
    communication: asyncio.Task[tuple[bytes, bytes]] | None = None

    try:
        process = await asyncio.shield(starting)
        communication = asyncio.create_task(
            asyncio.to_thread(process.communicate, data)
        )

        # Keep pipe draining alive so cancellation can kill and reap the child.
        output, _stderr = await asyncio.shield(communication)

        if process.returncode != 0:
            raise ValueError("Document extraction failed; check the document format")

        result = json.loads(output)

        if result.get("error"):
            raise ValueError(result["error"])

        return [Document.model_validate(document) for document in result["documents"]]
    finally:
        # Creation may still be running in a thread when the caller cancels.
        process = await starting

        if process.poll() is None:
            with suppress(ProcessLookupError):
                process.kill()

        # Drain pipes after cancellation so a full output pipe cannot stall reaping.
        if communication is None:
            await asyncio.to_thread(process.communicate)
        else:
            await communication


if __name__ == "__main__":
    try:
        encoding = sys.argv[2] if len(sys.argv) > 2 else "auto"
        chunks = split_document(
            sys.argv[1],
            sys.stdin.buffer.read(),
            text_encoding=None if encoding == "auto" else encoding,
        )
        payload = {"documents": [chunk.model_dump() for chunk in chunks]}
    except ValueError as error:
        # Extraction errors cross the subprocess boundary as bounded user-readable data.
        payload = {"error": str(error)[:500]}

    # The subprocess wire format is UTF-8 regardless of the host's pipe locale.
    sys.stdout.buffer.write(json.dumps(payload, ensure_ascii=False).encode("utf-8"))
