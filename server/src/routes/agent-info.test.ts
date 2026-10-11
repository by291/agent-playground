import { test, vi } from "vitest";
import assert from "node:assert/strict";
import { app } from "../app.js";

test("agent metadata comes from Python rather than the server environment", async () => {
  vi.stubEnv("DEEPSEEK_MODEL", "wrong-server-model");
  vi.stubGlobal("fetch", (url: URL) => {
    assert.equal(url.pathname, "/agent-info");

    return Promise.resolve(Response.json({ model: "configured-agent-model" }));
  });
  const response = await app.request("/agent-info");

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { model: "configured-agent-model" });
});

test("unavailable and malformed upstream metadata do not fabricate a model name", async () => {
  for (const upstream of [
    new Response(null, { status: 503 }),
    Response.json({ model: "" }),
  ]) {
    vi.stubGlobal("fetch", () => Promise.resolve(upstream));
    const response = await app.request("/agent-info");

    assert.equal(response.status, 503);
  }
});

test("the public model catalog preserves availability and removes provider secrets", async () => {
  vi.stubGlobal("fetch", () =>
    Promise.resolve(
      Response.json({
        model: "deepseek-flash",
        defaultModelId: "deepseek",
        apiKey: "private",
        models: [
          {
            id: "deepseek",
            label: "DeepSeek",
            model: "deepseek-flash",
            available: true,
          },
          {
            id: "qwen",
            label: "Qwen",
            model: "qwen3.8-flash",
            available: false,
            apiBase: "private",
          },
        ],
      }),
    ),
  );
  const response = await app.request("/agent-info");

  assert.deepEqual(await response.json(), {
    model: "deepseek-flash",
    defaultModelId: "deepseek",
    models: [
      {
        id: "deepseek",
        label: "DeepSeek",
        model: "deepseek-flash",
        available: true,
      },
      { id: "qwen", label: "Qwen", model: "qwen3.8-flash", available: false },
    ],
  });
});
