import { createServer } from "node:http";
import { afterEach, expect, test, vi } from "vitest";
import { context, metrics, propagation, trace } from "@opentelemetry/api";

const resources = vi.hoisted(() => ({
  stopWorker: vi.fn(),
  stopFiles: vi.fn(),
  stopKnowledge: vi.fn(),
  closeStore: vi.fn(),
  closeDatabase: vi.fn(),
  closeHttp: vi.fn(),
  closeConnections: vi.fn(),
  closeSubscriptions: vi.fn(),
}));

vi.mock("./app.js", () => ({ app: { fetch: vi.fn() } }));
vi.mock("./db/database.js", () => ({
  migrateServer: vi.fn(),
  db: { $client: { end: resources.closeDatabase } },
}));
vi.mock("./conversation/tasks/task-worker.js", () => ({
  startExternalTaskWorker: () => resources.stopWorker,
}));
vi.mock("./conversation/files/skill-file-cleanup.js", () => ({
  startSkillFileCleanup: () => resources.stopFiles,
}));
vi.mock("./knowledge/cleanup.js", () => ({
  startKnowledgeCleanup: () => resources.stopKnowledge,
}));
vi.mock("./storage/object-store.js", () => ({
  closeObjectStore: resources.closeStore,
}));
vi.mock("./conversation/events/subscription.js", () => ({
  closeConversationChanges: resources.closeSubscriptions,
}));
vi.mock("@hono/node-server", () => ({
  serve: () => ({
    close: resources.closeHttp,
    closeAllConnections: resources.closeConnections,
  }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
  trace.disable();
  metrics.disable();
  propagation.disable();
  context.disable();
});

test("the telemetry-enabled server drains application resources before exporting shutdown work", async () => {
  const events: string[] = [];
  const payloads: string[] = [];
  const collector = createServer((request, response) => {
    const chunks: Buffer[] = [];

    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      events.push(`export:${request.url}`);
      payloads.push(Buffer.concat(chunks).toString());
      response.writeHead(200);
      response.end("{}");
    });
  });

  await new Promise<void>((resolve) =>
    collector.listen(0, "127.0.0.1", resolve),
  );
  const address = collector.address();

  expect(address && typeof address !== "string").toBe(true);
  vi.stubEnv(
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`,
  );
  const originalSignals = new Set([
    ...process.listeners("SIGTERM"),
    ...process.listeners("SIGINT"),
  ]);
  const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
  let releaseWorker!: () => void;
  const workerReleased = new Promise<void>((resolve) => {
    releaseWorker = resolve;
  });

  resources.stopWorker.mockImplementation(async () => {
    await workerReleased;
    trace.getTracer("shutdown-test").startSpan("worker.shutdown").end();
    events.push("worker");
  });
  resources.stopFiles.mockImplementation(() => {
    events.push("files");

    return Promise.resolve();
  });
  resources.stopKnowledge.mockImplementation(() => {
    events.push("knowledge");

    return Promise.resolve();
  });
  resources.closeHttp.mockImplementation((done: () => void) => {
    events.push("http");
    done();
  });
  resources.closeStore.mockImplementation(() => {
    events.push("store");
  });
  resources.closeSubscriptions.mockImplementation(() => {
    events.push("subscriptions");

    return Promise.resolve();
  });
  resources.closeDatabase.mockImplementation(() => {
    trace.getTracer("shutdown-test").startSpan("database.shutdown").end();
    metrics
      .getMeter("shutdown-test")
      .createCounter("shutdown.completed")
      .add(1);
    events.push("database");

    return Promise.resolve();
  });

  try {
    await import("./observability/bootstrap.js");
    await import("./main.js");
    trace.getTracer("shutdown-test").startSpan("before.shutdown").end();

    for (const handler of process.listeners("SIGTERM")) {
      if (!originalSignals.has(handler)) {
        handler("SIGTERM");
      }
    }

    // Keep the worker in flight long enough to expose an independent telemetry owner.
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    releaseWorker();
    await vi.waitUntil(() =>
      events.some((event) => event.startsWith("export:")),
    );
    await vi.waitUntil(() => events.includes("database"));
    await new Promise<void>((resolve) => setTimeout(resolve, 30));

    expect(kill).not.toHaveBeenCalled();
    expect(events.indexOf("store")).toBeGreaterThan(events.indexOf("worker"));
    expect(events).toContain("subscriptions");
    expect(events.indexOf("subscriptions")).toBeGreaterThan(
      events.indexOf("http"),
    );
    expect(events.indexOf("database")).toBeGreaterThan(
      events.indexOf("subscriptions"),
    );
    expect(events.indexOf("database")).toBeGreaterThan(events.indexOf("store"));
    expect(
      events.findIndex((event) => event.startsWith("export:")),
    ).toBeGreaterThan(events.indexOf("database"));
    expect(payloads.join("\n")).toContain("worker.shutdown");
    expect(payloads.join("\n")).toContain("database.shutdown");
    expect(payloads.join("\n")).toContain("shutdown.completed");
  } finally {
    releaseWorker();

    for (const signal of ["SIGTERM", "SIGINT"] as const) {
      for (const handler of process.listeners(signal)) {
        if (!originalSignals.has(handler)) {
          process.removeListener(signal, handler);
        }
      }
    }

    await new Promise<void>((resolve) => collector.close(() => resolve()));
  }
});

test("a storage shutdown failure still releases the database", async () => {
  vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "");
  const originalExitCode = process.exitCode;
  const originalSignals = new Set([
    ...process.listeners("SIGTERM"),
    ...process.listeners("SIGINT"),
  ]);
  const released: string[] = [];

  for (const resource of Object.values(resources)) {
    resource.mockReset();
  }

  resources.closeHttp.mockImplementation((done: () => void) => done());
  resources.closeStore.mockImplementation(() => {
    throw new Error("Object store shutdown failed");
  });
  resources.closeDatabase.mockImplementation(() => {
    released.push("database");

    return Promise.resolve();
  });
  process.exitCode = 0;

  try {
    await import("./main.js");

    for (const handler of process.listeners("SIGTERM")) {
      if (!originalSignals.has(handler)) {
        handler("SIGTERM");
      }
    }

    await vi.waitUntil(() => process.exitCode === 1);
    expect(released).toEqual(["database"]);
  } finally {
    process.exitCode = originalExitCode;

    for (const signal of ["SIGTERM", "SIGINT"] as const) {
      for (const handler of process.listeners(signal)) {
        if (!originalSignals.has(handler)) {
          process.removeListener(signal, handler);
        }
      }
    }
  }
});
