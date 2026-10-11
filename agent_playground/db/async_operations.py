"""Keep blocking database operations owned until their threads finish."""

import asyncio
import logging
from collections.abc import Callable

logger = logging.getLogger(__name__)


async def run_database_operation[**P, T](
    operation: Callable[P, T], *args: P.args, **kwargs: P.kwargs
) -> T:
    """Drain the blocking operation before propagating caller cancellation."""
    task = asyncio.create_task(asyncio.to_thread(operation, *args, **kwargs))

    try:
        return await asyncio.shield(task)
    except asyncio.CancelledError:
        # Cancelling an asyncio waiter cannot stop a running database thread.
        # Drain it before propagating cancellation so shutdown can dispose safely.
        while not task.done():
            try:
                await asyncio.wait({task})
            except asyncio.CancelledError:
                continue

        if not task.cancelled() and (error := task.exception()) is not None:
            logger.warning(
                "Database operation failed while draining cancellation",
                exc_info=(type(error), error, error.__traceback__),
            )

        raise
