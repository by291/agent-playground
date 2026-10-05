"""Calibrate one document's reservations using validated provider usage."""

import math
from collections import deque
from collections.abc import Sequence


def conservative_tokens(text: str) -> int:
    # Use a vocabulary-independent byte estimate until enough usage is available.
    return len(text.encode("utf-8")) + 8


class EmbeddingTokenEstimator:
    def __init__(self):
        self._ratios: deque[float] = deque(maxlen=12)
        self._smoothed_ratio: float | None = None
        self._backed_off = False

    @property
    def samples(self) -> int:
        return len(self._ratios)

    @property
    def ratio(self) -> float:
        if self._backed_off or len(self._ratios) < 3:
            return 1.0

        # Recent peaks react immediately; EWMA makes their expiry less abrupt.
        upper = max(self._smoothed_ratio or 0, max(self._ratios))

        return upper * 1.25

    def estimate(self, text: str) -> int:
        return max(8, math.ceil(conservative_tokens(text) * self.ratio))

    def observe(self, texts: Sequence[str], tokens: int | None) -> None:
        if self._backed_off:
            return

        if type(tokens) is not int or tokens <= 0:
            self._ratios.clear()
            self._smoothed_ratio = None

            return

        size = sum(conservative_tokens(text) for text in texts)

        # Tiny inputs are dominated by per-input overhead and do not teach document costs.
        if size < 256:
            return

        ratio = tokens / size
        self._ratios.append(ratio)

        if self._smoothed_ratio is None:
            self._smoothed_ratio = ratio
        else:
            self._smoothed_ratio = 0.3 * ratio + 0.7 * self._smoothed_ratio

    def backoff(self) -> None:
        # A 429 may come from outside this app; keep this attempt conservative either way.
        self._backed_off = True
