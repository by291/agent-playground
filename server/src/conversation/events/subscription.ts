import pg from "pg";
import { logger } from "../../observability/logger.js";

interface Subscriber {
  threadId: string;
  ready(): void;
  changed(): void;
  close(): void;
}

interface Listener {
  client: pg.Client;
  subscribers: Set<Subscriber>;
  ready: Promise<void>;
  closing?: Promise<void>;
}

let listener: Listener | undefined;
let stopped = false;
const draining = new Set<Promise<void>>();

function retire(current: Listener): Promise<void> {
  if (current.closing) {
    return current.closing;
  }

  if (listener === current) {
    listener = undefined;
  }

  for (const subscriber of current.subscribers) {
    subscriber.close();
  }

  current.subscribers.clear();
  current.closing = current.client.end().catch((error: unknown) => {
    logger.warn({ err: error }, "Conversation listener shutdown failed");
  });
  draining.add(current.closing);
  void current.closing.finally(() => draining.delete(current.closing!));

  return current.closing;
}

function openListener(): Listener {
  const client = new pg.Client({
    connectionString: process.env.APP_DATABASE_URL,
  });
  const current: Listener = {
    client,
    subscribers: new Set(),
    ready: Promise.resolve(),
  };

  client.on("notification", (notification) => {
    for (const subscriber of current.subscribers) {
      if (subscriber.threadId === notification.payload) {
        subscriber.changed();
      }
    }
  });
  client.on("error", (error) => {
    logger.warn({ err: error }, "Conversation listener connection lost");
    void retire(current);
  });
  current.ready = (async () => {
    try {
      await client.connect();

      if (!current.closing) {
        await client.query("LISTEN conversation_changed");
      }
    } catch (error) {
      logger.warn({ err: error }, "Conversation listener connection failed");
      void retire(current);
    }
  })();

  return current;
}

export function subscribeConversationChanges(
  threadId: string,
  callbacks: Omit<Subscriber, "threadId">,
): () => void {
  // A route may finish its database lookup after HTTP shutdown has started.
  // Once the process owner closes this hub, late requests cannot recreate it.
  if (stopped) {
    callbacks.close();

    return () => undefined;
  }

  const current = (listener ??= openListener());
  const subscriber = { threadId, ...callbacks };

  current.subscribers.add(subscriber);

  // A ready-triggered snapshot covers changes before LISTEN; later ones arrive as notifications.
  void current.ready.then(() => {
    if (current.subscribers.has(subscriber)) {
      subscriber.ready();
    }
  });

  return () => {
    current.subscribers.delete(subscriber);

    if (!current.subscribers.size) {
      void retire(current);
    }
  };
}

/** Permanently stops the process-owned hub and waits for every retiring connection. */
export async function closeConversationChanges(): Promise<void> {
  stopped = true;

  if (listener) {
    await retire(listener);
  }

  await Promise.all(draining);
}
