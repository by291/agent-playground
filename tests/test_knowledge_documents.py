"""Text encoding decisions at the document extraction boundary."""

import asyncio
import codecs

import pytest

from agent_playground.knowledge.documents import extract_document, split_document


@pytest.mark.parametrize(
    "encoding, marker",
    [
        ("utf-8", codecs.BOM_UTF8),
        ("utf-16-le", codecs.BOM_UTF16_LE),
        ("utf-16-be", codecs.BOM_UTF16_BE),
        ("utf-32-le", codecs.BOM_UTF32_LE),
        ("utf-32-be", codecs.BOM_UTF32_BE),
    ],
)
def test_unicode_documents_use_their_bom(encoding: str, marker: bytes):
    content = "退货期限为三十天。Keep the original receipt."

    chunks = split_document("policy.md", marker + content.encode(encoding))

    assert chunks[0].page_content == content
    assert chunks[0].metadata == {"name": "policy.md", "page": None}


@pytest.mark.parametrize(
    "encoding, content",
    [
        (
            "gb18030",
            "这是一份知识库测试文档。退货期限为三十天，商品必须保持完整。",
        ),
        (
            "big5",
            "這是一份知識庫文件。退貨期限為三十天，商品必須保持完整。",
        ),
        (
            "cp1252",
            "Les élèves étudient la politique de retour. Le délai est de trente jours.",
        ),
        ("utf-16-le", "Return policy: items may be returned within thirty days."),
        (
            "shift_jis",
            "返品ポリシーをご確認ください。商品は三十日以内に返品できます。",
        ),
    ],
)
def test_legacy_documents_are_detected_without_changing_text(
    encoding: str, content: str
):
    chunks = split_document("policy.txt", content.encode(encoding))

    assert chunks[0].page_content == content


def test_short_ambiguous_text_requires_an_encoding_instead_of_becoming_garbage():
    data = "你好，世界".encode("gbk")

    with pytest.raises(ValueError, match="[Cc]hoose.*encoding"):
        split_document("short.txt", data)

    chunks = split_document("short.txt", data, text_encoding="gbk")

    assert chunks[0].page_content == "你好，世界"


@pytest.mark.parametrize("text_encoding", [None, "utf-8", "gb18030"])
def test_binary_content_is_rejected_even_with_an_explicit_encoding(
    text_encoding: str | None,
):
    with pytest.raises(ValueError, match="[Tt]ext|encoding"):
        split_document(
            "binary.txt", b"plain\x00\x01\x02bytes", text_encoding=text_encoding
        )


def test_invalid_bom_and_wrong_explicit_encodings_do_not_fall_back():
    with pytest.raises(ValueError, match="encoding"):
        split_document("broken.txt", codecs.BOM_UTF16_LE + b"x")

    with pytest.raises(ValueError, match="encoding"):
        split_document("short.txt", "你好".encode("gbk"), text_encoding="utf-8")

    with pytest.raises(ValueError, match="encoding"):
        split_document("policy.txt", b"hello", text_encoding="utf-7")

    with pytest.raises(ValueError, match="encoding"):
        split_document("policy.pdf", b"not a PDF", text_encoding="gbk")


def test_an_explicit_legacy_encoding_cannot_override_a_unicode_bom():
    data = codecs.BOM_UTF8 + "Return policy: café receipts.".encode()

    with pytest.raises(ValueError, match="encoding"):
        split_document("policy.txt", data, text_encoding="cp1252")


def test_subprocess_carries_the_encoding_and_returns_unicode_independently_of_locale(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv("PYTHONIOENCODING", "ascii")

    chunks = asyncio.run(
        extract_document("short.txt", "你好，世界".encode("gbk"), text_encoding="gbk")
    )

    assert chunks[0].page_content == "你好，世界"
