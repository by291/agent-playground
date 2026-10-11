"""Reject quota settings that would make admission unsafe or impossible."""

import pytest

from agent_playground.knowledge.config import EmbeddingConfig
from tests.model_config import ModelConfigFile


@pytest.mark.parametrize(
    "variable,value",
    [
        ("tokens_per_minute", 0),
        ("requests_per_minute", -1),
        ("max_retries", -1),
        ("index_timeout", "nan"),
    ],
)
def test_invalid_embedding_limits_fail_before_sending(
    variable: str, value: str | int, model_config: ModelConfigFile
):
    model_config.embedding(model="test-model", api_key="test-key", **{variable: value})

    with pytest.raises(ValueError, match=variable):
        EmbeddingConfig.from_config()
