import { logger } from "../observability/logger.js";
import { listObjects } from "./object-store.js";

const cleanupIntervalMs = 30_000;

/** Creates an object scan whose pagination state belongs to one cleanup worker. */
export function createObjectReconciler(
  prefix: string,
  enqueueKeys: (keys: string[]) => Promise<void>,
) {
  let continuationToken: string | undefined;

  return async (signal?: AbortSignal) => {
    try {
      // A remote PUT can finish after deletion, so rediscover tombstones one page at a time.
      const page = await listObjects(prefix, continuationToken, signal);

      if (page.keys.length) {
        await enqueueKeys(page.keys);
      }

      continuationToken = page.continuationToken;
    } catch (error) {
      continuationToken = undefined;

      throw error;
    }
  };
}

/** Starts cleanup ticks and returns an async stop function that drains the active tick. */
export function startObjectCleanup(
  cleanup: (signal: AbortSignal) => Promise<void>,
  failureMessage: string,
) {
  const controller = new AbortController();
  let active: Promise<void> | undefined;

  function tick() {
    if (controller.signal.aborted || active) {
      return;
    }

    active = cleanup(controller.signal)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          logger.error({ err: error }, failureMessage);
        }
      })
      .finally(() => {
        active = undefined;
      });
  }

  const timer = setInterval(tick, cleanupIntervalMs);

  timer.unref();
  tick();

  return async () => {
    clearInterval(timer);
    controller.abort();

    await active;
  };
}
