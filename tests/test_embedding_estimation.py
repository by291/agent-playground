"""Check adaptive reservations against independent provider usage samples."""

import pytest

from agent_playground.knowledge.token_estimation import EmbeddingTokenEstimator


def test_successful_usage_reduces_reservations_without_removing_headroom():
    estimator = EmbeddingTokenEstimator()
    text = "中文" * 100
    conservative = estimator.estimate(text)
    assert conservative == 608

    for _ in range(2):
        estimator.observe([text], 128)
        assert estimator.estimate(text) == conservative

    estimator.observe([text], 128)
    assert 150 <= estimator.estimate(text) <= 180


def test_higher_usage_increases_the_next_reservation_immediately():
    estimator = EmbeddingTokenEstimator()
    text = "中文" * 100

    for _ in range(3):
        estimator.observe([text], 128)

    before = estimator.estimate(text)
    estimator.observe([text], 400)
    assert estimator.estimate(text) >= 480
    assert estimator.estimate(text) > before


def test_old_high_usage_does_not_permanently_keep_reservations_high():
    estimator = EmbeddingTokenEstimator()
    text = "中文" * 100

    for _ in range(3):
        estimator.observe([text], 400)

    for _ in range(20):
        estimator.observe([text], 128)

    assert 150 <= estimator.estimate(text) <= 200


@pytest.mark.parametrize("usage", [None, 0, -1])
def test_unusable_usage_restores_conservative_reservations(usage: int | None):
    estimator = EmbeddingTokenEstimator()
    text = "中文" * 100

    for _ in range(3):
        estimator.observe([text], 128)

    assert estimator.estimate(text) < 200
    estimator.observe([text], usage)
    assert estimator.estimate(text) == 608


def test_short_text_samples_do_not_train_document_reservations():
    estimator = EmbeddingTokenEstimator()

    for _ in range(10):
        estimator.observe(["hi"], 1)

    assert estimator.estimate("中文" * 100) == 608


def test_quota_backoff_keeps_the_rest_of_the_attempt_conservative():
    estimator = EmbeddingTokenEstimator()
    text = "中文" * 100

    for _ in range(3):
        estimator.observe([text], 128)

    assert estimator.estimate(text) < 200
    estimator.backoff()

    for _ in range(5):
        estimator.observe([text], 128)

    assert estimator.estimate(text) == 608
