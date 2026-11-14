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

UNICODE_SIGNATURES = {
    "utf_8",
    "utf_16",
    "utf_32",
}
DETECTION_THRESHOLD = 0.1
MIN_EVIDENCE_CHARS = 20
MIN_COHERENCE = 0.2
AMBIGUOUS_COHERENCE_MARGIN = 0.2


def is_document_text(content: str) -> bool:
    """Reject decoded content containing disallowed controls or noncharacters."""
    return all(
        character in "\t\n\r\f"
        or (
            unicodedata.category(character) != "Cc"
            and character not in {"\ufffe", "\uffff"}
        )
        for character in content
    )


def decode_text(source_bytes: bytes, text_encoding: str | None = None) -> str:
    """Decode signed or explicitly encoded text and reject ambiguous detection."""
    if text_encoding is not None and text_encoding not in TEXT_ENCODINGS:
        raise ValueError("Unsupported text encoding")

    # A signature is authoritative. A malformed signed file must not fall back
    # to a legacy codec that happens to accept its bytes.
    signed_encoding, _marker = identify_sig_or_bom(source_bytes)

    if signed_encoding is not None:
        if signed_encoding not in UNICODE_SIGNATURES:
            raise ValueError("Unsupported text encoding signature")

        content = decode_known_encoding(source_bytes, signed_encoding)

        if (
            text_encoding is not None
            and decode_known_encoding(source_bytes, text_encoding) != content
        ):
            raise ValueError(
                "The selected text encoding conflicts with the Unicode signature"
            )

        return content

    if text_encoding is not None:
        return decode_known_encoding(source_bytes, text_encoding)

    try:
        content = source_bytes.decode("utf-8")
    except UnicodeDecodeError:
        pass
    else:
        if is_document_text(content):
            return content

    matches = from_bytes(
        source_bytes, cp_isolation=list(TEXT_ENCODINGS), threshold=DETECTION_THRESHOLD
    )
    candidates = [match for match in matches if is_document_text(str(match))]

    if not candidates:
        raise ValueError(ENCODING_HELP)

    best = candidates[0]
    content = str(best)

    # Coherence is language evidence, not a probability of correctness. Short
    # unsigned text and competing decodings need an explicit user choice.
    has_too_little_evidence = (
        len(content.strip()) < MIN_EVIDENCE_CHARS and best.coherence < MIN_COHERENCE
    )
    is_ambiguous = any(
        str(candidate) != content
        and candidate.coherence >= best.coherence - AMBIGUOUS_COHERENCE_MARGIN
        for candidate in candidates[1:]
    )

    if has_too_little_evidence or is_ambiguous:
        raise ValueError(ENCODING_HELP)

    return content


def decode_known_encoding(source_bytes: bytes, encoding: str) -> str:
    """Validate decoded text against a known encoding without guessing."""
    codec = "utf-8-sig" if encoding in {"utf-8", "utf_8"} else encoding

    try:
        content = source_bytes.decode(codec).removeprefix("\ufeff")
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
