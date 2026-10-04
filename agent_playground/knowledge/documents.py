"""Extract text with source pages and split it using LangChain's splitter."""

import asyncio
import json
import sys
from contextlib import suppress
from io import BytesIO
from pathlib import Path

from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from pypdf import PdfReader


def split_document(name: str, data: bytes) -> list[Document]:
    suffix = Path(name).suffix.lower()

    if suffix == ".pdf":
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
        try:
            content = data.decode("utf-8-sig")
        except UnicodeDecodeError as error:
            raise ValueError("TXT and Markdown files must use UTF-8") from error

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


async def extract_document(name: str, data: bytes) -> list[Document]:
    process = await asyncio.create_subprocess_exec(
        sys.executable,
        "-m",
        "agent_playground.knowledge.documents",
        name,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    try:
        output, _stderr = await process.communicate(data)

        if process.returncode != 0:
            raise ValueError("Document extraction failed; check the document format")

        result = json.loads(output)

        if result.get("error"):
            raise ValueError(result["error"])

        return [Document.model_validate(document) for document in result["documents"]]
    finally:
        if process.returncode is None:
            with suppress(ProcessLookupError):
                process.kill()

        # Drain pipes after cancellation so a full output pipe cannot stall reaping.
        await process.communicate()


if __name__ == "__main__":
    try:
        chunks = split_document(sys.argv[1], sys.stdin.buffer.read())
        payload = {"documents": [chunk.model_dump() for chunk in chunks]}
    except ValueError as error:
        # Extraction errors cross the subprocess boundary as bounded user-readable data.
        payload = {"error": str(error)[:500]}

    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
