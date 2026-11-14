"""Calibrate one document's reservations using validated provider usage."""

import math
from collections import deque
from collections.abc import Sequence

TOKENS_PER_INPUT = 8
MAX_CALIBRATION_SAMPLES = 12
MIN_CALIBRATION_SAMPLES = 3
CALIBRATED_HEADROOM = 1.25
MIN_CALIBRATION_SIZE = 256
NEW_SAMPLE_WEIGHT = 0.3
PREVIOUS_SAMPLE_WEIGHT = 0.7


def conservative_tokens(text: str) -> int:
    """Estimate tokens from UTF-8 byte length and per-input overhead."""
    # Use a vocabulary-independent byte estimate until enough usage is available.
    return len(text.encode("utf-8")) + TOKENS_PER_INPUT


class EmbeddingTokenEstimator:
    """Keep usage calibration local to one document attempt, including retry backoff."""

    def __init__(self) -> None:
        self._ratios: deque[float] = deque(maxlen=MAX_CALIBRATION_SAMPLES)
        self._smoothed_ratio: float | None = None
        self._backed_off = False

    @property
    def samples(self) -> int:
        """Return the number of retained calibration samples."""
        return len(self._ratios)

    @property
    def ratio(self) -> float:
        """Return the conservative or calibrated multiplier for a reservation."""
        if self._backed_off or len(self._ratios) < MIN_CALIBRATION_SAMPLES:
            return 1.0

        # Recent peaks react immediately; EWMA makes their expiry less abrupt.
        upper = max(self._smoothed_ratio or 0, max(self._ratios))

        return upper * CALIBRATED_HEADROOM

    def estimate(self, text: str) -> int:
        """Estimate the quota cost of one text using the current calibration."""
        return max(TOKENS_PER_INPUT, math.ceil(conservative_tokens(text) * self.ratio))

    def observe(self, texts: Sequence[str], tokens: int | None) -> None:
        """Update calibration from a complete batch with usable provider usage."""
        if self._backed_off:
            return

        if type(tokens) is not int or tokens <= 0:
            self._ratios.clear()
            self._smoothed_ratio = None

            return

        size = sum(conservative_tokens(text) for text in texts)

        # Tiny inputs are dominated by per-input overhead and do not teach document costs.
        if size < MIN_CALIBRATION_SIZE:
            return

        ratio = tokens / size
        self._ratios.append(ratio)

        if self._smoothed_ratio is None:
            self._smoothed_ratio = ratio
        else:
            self._smoothed_ratio = (
                NEW_SAMPLE_WEIGHT * ratio
                + PREVIOUS_SAMPLE_WEIGHT * self._smoothed_ratio
            )

    def backoff(self) -> None:
        """Use conservative reservations for the remainder of this attempt."""
        # A 429 may come from outside this app; keep this attempt conservative either way.
        self._backed_off = True
