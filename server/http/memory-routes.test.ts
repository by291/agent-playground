import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";
import { app } from "../app";

const id = "8ad2b08f-d6f1-4c74-90f2-a25ded829b36";
const memory = {
  id,
  category: "preference",
  project: null,
  text: "Use concise explanations.",
  sourceThreadId: "source-thread",
  sourceMessageId: null,
  revision: 2,
  createdAt: "2026-10-10T00:00:00Z",
  updatedAt: "2026-10-10T01:00:00+00:00",
};
const mutation = { category: "preference", project: null, revision: 2 };

beforeEach(() => {
  vi.stubEnv("AEGRA_URL", "https://agent.example/runtime/");
  vi.stubEnv("WORKFLOW_API_TOKEN", "private-workflow-token");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function jsonRequest(method: string, body: unknown) {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

test("lists validated memory pages with server credentials and fixed upstream routing", async () => {
  vi.stubGlobal("fetch", (input: URL, init: RequestInit) => {
    assert.equal(
      input.href,
      "https://agent.example/runtime/memory?offset=0&limit=50",
    );
    assert.equal(
      new Headers(init.headers).get("Authorization"),
      "Bearer private-workflow-token",
    );
    assert.ok(init.signal instanceof AbortSignal);

    return Promise.resolve(
      Response.json({
        items: [{ ...memory, apiToken: "upstream-secret" }],
        nextOffset: 50,
        credential: "upstream-secret",
      }),
    );
  });
  const response = await app.request("/api/memories", {
    headers: { Authorization: "Bearer browser-token" },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { items: [memory], nextOffset: 50 });
});

test("forwards a validated explicit page offset and size", async () => {
  vi.stubGlobal("fetch", (input: URL) => {
    assert.equal(
      input.href,
      "https://agent.example/runtime/memory?offset=75&limit=25",
    );

    return Promise.resolve(Response.json({ items: [], nextOffset: null }));
  });
  const response = await app.request("/api/memories?offset=75&limit=25");

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { items: [], nextOffset: null });
});

test.each([
  "offset=-1",
  "offset=1.5",
  "offset=1000001",
  "offset=",
  "limit=0",
  "limit=101",
  "limit=bad",
  "offset=1&offset=2",
  "url=https://malicious.example",
  "project=secret",
])(
  "rejects invalid or open-ended pagination query %s before contacting Python",
  async (query) => {
    vi.stubGlobal("fetch", () => {
      assert.fail("Invalid input reached the upstream");
    });
    const response = await app.request(`/api/memories?${query}`);

    assert.equal(response.status, 400);
  },
);

test("edits memory with trimmed text and preserves the selected scope and revision", async () => {
  vi.stubGlobal("fetch", (input: URL, init: RequestInit) => {
    assert.equal(input.href, `https://agent.example/runtime/memory/${id}`);
    assert.equal(init.method, "PATCH");
    assert.equal(
      new Headers(init.headers).get("Content-Type"),
      "application/json",
    );
    assert.ok(typeof init.body === "string");
    assert.deepEqual(JSON.parse(init.body), {
      ...mutation,
      text: "Prefer examples.",
    });

    return Promise.resolve(
      Response.json({
        ...memory,
        revision: 3,
        text: "Prefer examples.",
        token: "upstream-secret",
      }),
    );
  });
  const response = await app.request(
    `/api/memories/${id}`,
    jsonRequest("PATCH", { ...mutation, text: "  Prefer examples.  " }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ...memory,
    revision: 3,
    text: "Prefer examples.",
  });
});

test("forgets a project memory using the exact namespace and revision", async () => {
  const projectMutation = {
    category: "project",
    project: "Agent Playground",
    revision: 3,
  };

  vi.stubGlobal("fetch", (input: URL, init: RequestInit) => {
    assert.equal(input.pathname, `/runtime/memory/${id}`);
    assert.equal(init.method, "DELETE");
    assert.ok(typeof init.body === "string");
    assert.deepEqual(JSON.parse(init.body), projectMutation);

    return Promise.resolve(new Response(null, { status: 204 }));
  });
  const response = await app.request(
    `/api/memories/${id}`,
    jsonRequest("DELETE", projectMutation),
  );

  assert.equal(response.status, 204);
  assert.equal(await response.text(), "");
});

test("accepts astral characters at the shared UTF16 text, project and provenance boundaries", async () => {
  const project = "🦊".repeat(50);
  const text = "🦊".repeat(500);
  const sourceId = "🦊".repeat(128);
  const record = {
    ...memory,
    category: "project",
    project,
    text,
    sourceThreadId: sourceId,
    sourceMessageId: sourceId,
  };

  vi.stubGlobal("fetch", () => Promise.resolve(Response.json(record)));
  const response = await app.request(
    `/api/memories/${id}`,
    jsonRequest("PATCH", { category: "project", project, revision: 2, text }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), record);
});

test.each([
  { category: "preference", project: "unexpected", revision: 2 },
  { category: "project", project: null, revision: 2 },
  { category: "project", project: "   ", revision: 2 },
  { category: "project", project: "x".repeat(101), revision: 2 },
  { category: "project", project: "🦊".repeat(51), revision: 2 },
  { category: "other", project: null, revision: 2 },
  { category: "preference", project: null, revision: 0 },
  { category: "preference", project: null, revision: 1.5 },
  { category: "preference", project: null, revision: "2" },
  { category: "preference", project: null },
  { ...mutation, upstreamUrl: "https://malicious.example" },
])("rejects invalid mutation scope or revision %j", async (body) => {
  vi.stubGlobal("fetch", () => {
    assert.fail("Invalid input reached the upstream");
  });

  for (const method of ["PATCH", "DELETE"]) {
    const response = await app.request(
      `/api/memories/${id}`,
      jsonRequest(
        method,
        method === "PATCH" ? { ...body, text: "Updated" } : body,
      ),
    );

    assert.equal(response.status, 400);
  }
});

test.each(["", "   ", "x".repeat(1001), "🦊".repeat(501), 3, null])(
  "rejects invalid memory edit text %j",
  async (text) => {
    vi.stubGlobal("fetch", () => {
      assert.fail("Invalid input reached the upstream");
    });
    const response = await app.request(
      `/api/memories/${id}`,
      jsonRequest("PATCH", { ...mutation, text }),
    );

    assert.equal(response.status, 400);
  },
);

test("rejects malformed JSON and invalid UUIDs before contacting Python", async () => {
  vi.stubGlobal("fetch", () => {
    assert.fail("Invalid input reached the upstream");
  });

  for (const method of ["PATCH", "DELETE"]) {
    const invalidId = await app.request(
      "/api/memories/not-a-uuid",
      jsonRequest(method, { ...mutation, text: "Updated" }),
    );
    const invalidJson = await app.request(`/api/memories/${id}`, {
      method,
      body: "{",
      headers: { "Content-Type": "application/json" },
    });

    assert.equal(invalidId.status, 400);
    assert.equal(invalidJson.status, 400);
  }
});

test.each([404, 409, 422])(
  "preserves actionable upstream mutation status %s without exposing its error body",
  async (status) => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        Response.json(
          { detail: "private-workflow-token https://private-host.example" },
          { status },
        ),
      ),
    );

    for (const method of ["PATCH", "DELETE"]) {
      const response = await app.request(
        `/api/memories/${id}`,
        jsonRequest(
          method,
          method === "PATCH" ? { ...mutation, text: "Updated" } : mutation,
        ),
      );
      const body = await response.text();

      assert.equal(response.status, status);
      assert.ok(!body.includes("private-workflow-token"));
      assert.ok(!body.includes("private-host"));
    }
  },
);

test.each([401, 403, 500, 503])(
  "turns unavailable upstream status %s into a sanitized service error",
  async (status) => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        Response.json({ detail: "private-workflow-token" }, { status }),
      ),
    );
    const response = await app.request("/api/memories");

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: "Memory service is unavailable",
    });
  },
);

test.each([
  { items: [{ ...memory, id: "invalid" }], nextOffset: null },
  { items: [{ ...memory, revision: 0 }], nextOffset: null },
  {
    items: [{ ...memory, category: "project", project: null }],
    nextOffset: null,
  },
  {
    items: [{ ...memory, category: "project", project: "🦊".repeat(51) }],
    nextOffset: null,
  },
  { items: [{ ...memory, sourceThreadId: "x".repeat(257) }], nextOffset: null },
  {
    items: [{ ...memory, sourceMessageId: "🦊".repeat(129) }],
    nextOffset: null,
  },
  { items: [{ ...memory, text: "" }], nextOffset: null },
  { items: [{ ...memory, createdAt: "yesterday" }], nextOffset: null },
  { items: [memory], nextOffset: -1 },
])("rejects malformed upstream memory pages %j", async (body) => {
  vi.stubGlobal("fetch", () => Promise.resolve(Response.json(body)));
  const response = await app.request("/api/memories");

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "Memory service is unavailable",
  });
});

test("keeps upstream parse and network failures sanitized", async () => {
  for (const fetchResult of [
    () => Promise.resolve(new Response("private-workflow-token")),
    () =>
      Promise.reject(
        new Error("private-workflow-token https://private-host.example"),
      ),
  ]) {
    vi.stubGlobal("fetch", fetchResult);
    const response = await app.request("/api/memories");

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: "Memory service is unavailable",
    });
  }
});

test("does not send unauthenticated upstream requests when the server credential is absent", async () => {
  vi.stubEnv("WORKFLOW_API_TOKEN", "");
  vi.stubGlobal("fetch", () => {
    assert.fail("Missing server credential reached the upstream");
  });
  const response = await app.request("/api/memories");

  assert.equal(response.status, 503);
});

test("cancels the upstream operation when the public request is aborted", async () => {
  const controller = new AbortController();

  vi.stubGlobal(
    "fetch",
    (_input: URL, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal!.addEventListener(
          "abort",
          () => reject(new Error("Upstream request aborted")),
          { once: true },
        );
        controller.abort(new Error("private-workflow-token"));
      }),
  );
  const response = await app.request(
    new Request("http://localhost/api/memories", { signal: controller.signal }),
  );

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "Memory service is unavailable",
  });
});

test(
  "bounds stalled upstream operations with a request timeout",
  { timeout: 10_000 },
  async () => {
    vi.stubGlobal(
      "fetch",
      (_input: URL, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener(
            "abort",
            () => reject(new Error("Upstream request aborted")),
            { once: true },
          );
        }),
    );
    const response = await app.request("/api/memories");

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: "Memory service is unavailable",
    });
  },
);
