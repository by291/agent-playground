"""Decode document text without silently accepting ambiguous legacy encodings."""

import unicodedata

from charset_normalizer import from_bytes
from charset_normalizer.utils import identify_sig_or_bom

TEXT_ENCODINGS = (
    "utf-8",
    "utf-16-le",
    "utf-16-be",
    "utf-32-le",
    "utf-32-be",
    "gb18030",
    "gbk",
    "big5",
    "cp1252",
    "shift_jis",
)
ENCODING_HELP = (
    "Could not reliably determine the text encoding. "
    "Choose Text encoding for this document and reindex it, or convert it to UTF-8."
)


def is_document_text(content: str) -> bool:
    return all(
        character in "\t\n\r\f"
        or (
            unicodedata.category(character) != "Cc"
            and character not in {"\ufffe", "\uffff"}
        )
        for character in content
    )


def decode_text(data: bytes, text_encoding: str | None = None) -> str:
    if text_encoding is not None and text_encoding not in TEXT_ENCODINGS:
        raise ValueError("Unsupported text encoding")

    # A signature is authoritative. A malformed signed file must not fall back
    # to a legacy codec that happens to accept its bytes.
    signed_encoding, _marker = identify_sig_or_bom(data)

    if signed_encoding is not None:
        if signed_encoding not in {"utf_8", "utf_16", "utf_32"}:
            raise ValueError("Unsupported text encoding signature")

        content = decode_known_encoding(data, signed_encoding)

        if (
            text_encoding is not None
            and decode_known_encoding(data, text_encoding) != content
        ):
            raise ValueError(
                "The selected text encoding conflicts with the Unicode signature"
            )

        return content

    if text_encoding is not None:
        return decode_known_encoding(data, text_encoding)

    try:
        content = data.decode("utf-8")
    except UnicodeDecodeError:
        pass
    else:
        if is_document_text(content):
            return content

    matches = from_bytes(data, cp_isolation=list(TEXT_ENCODINGS), threshold=0.1)
    candidates = [match for match in matches if is_document_text(str(match))]

    if not candidates:
        raise ValueError(ENCODING_HELP)

    best = candidates[0]
    content = str(best)
    # Coherence is language evidence, not a probability of correctness. Short
    # unsigned text and competing decodings need an explicit user choice.
    too_little_evidence = len(content.strip()) < 20 and best.coherence < 0.2
    ambiguous = any(
        str(candidate) != content and candidate.coherence >= best.coherence - 0.2
        for candidate in candidates[1:]
    )

    if too_little_evidence or ambiguous:
        raise ValueError(ENCODING_HELP)

    return content


def decode_known_encoding(data: bytes, encoding: str) -> str:
    codec = "utf-8-sig" if encoding in {"utf-8", "utf_8"} else encoding

    try:
        content = data.decode(codec).removeprefix("\ufeff")
    except UnicodeDecodeError as error:
        raise ValueError(
            f"The document does not match its {encoding} text encoding. "
            "Choose the correct Text encoding and reindex it."
        ) from error

    if not is_document_text(content):
        raise ValueError(
            "The file contains non-text data or uses a different text encoding"
        )

    return content
