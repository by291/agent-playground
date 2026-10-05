"""Reject quota settings that would make admission unsafe or impossible."""

import pytest

from agent_playground.knowledge.store import EmbeddingConfig


@pytest.mark.parametrize(
    "variable,value",
    [
        ("RAG_EMBEDDING_TPM", "0"),
        ("RAG_EMBEDDING_RPM", "-1"),
        ("RAG_EMBEDDING_MAX_RETRIES", "-1"),
        ("RAG_INDEX_TIMEOUT_SECONDS", "nan"),
    ],
)
def test_invalid_embedding_limits_fail_before_sending(
    variable: str, value: str, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("RAG_EMBEDDING_MODEL", "test-model")
    monkeypatch.setenv("RAG_EMBEDDING_API_KEY", "test-key")
    monkeypatch.setenv(variable, value)

    with pytest.raises(ValueError, match=variable):
        EmbeddingConfig.from_env()
