import assert from "node:assert/strict";
import { Hono } from "hono";
import { afterEach, test, vi } from "vitest";

vi.mock("../conversation/skill-files", () => ({
  storeSkillFile: () => Promise.resolve({}),
  readSkillFile: () =>
    Promise.resolve({ name: "file.txt", data: Buffer.from("skill") }),
}));
vi.mock("../knowledge/documents", () => ({
  changeDocument: () => Promise.resolve({}),
  uploadDocument: () => Promise.resolve({}),
  listDocuments: () => Promise.resolve([]),
  parseTextEncoding: () => "auto",
  readDocument: () =>
    Promise.resolve({
      name: "doc.txt",
      data: Buffer.from("document"),
    }),
  KnowledgeError: class extends Error {},
}));
vi.mock("../conversation/external-tasks", () => ({
  registerExternalTask: () =>
    Promise.resolve({
      taskId: "task",
      callbackToken: "callback",
    }),
  updateExternalTask: () => Promise.resolve({}),
}));

const { skillFileRoutes } = await import("./skill-file-routes");
const { knowledgeRoutes } = await import("./knowledge-routes");
const { externalTaskRoutes } = await import("./external-task-routes");
const app = new Hono();

app.route("/", skillFileRoutes);
app.route("/", knowledgeRoutes);
app.route("/", externalTaskRoutes);

afterEach(() => vi.unstubAllEnvs());

const routes = [
  {
    path: "/internal/skill-files/file?threadId=thread",
    message: "Invalid workflow credential",
  },
  {
    path: "/internal/knowledge/documents/doc/file",
    message: "Invalid application credential",
  },
  {
    path: "/internal/external-tasks",
    method: "POST",
    message: "Invalid workflow credential",
  },
];

test.each(routes)(
  "$path requires a Bearer credential and keeps JSON failures",
  async ({ path, method, message }) => {
    vi.stubEnv("WORKFLOW_API_TOKEN", "workflow-token");

    for (const authorization of [
      undefined,
      "workflow-token",
      "Bearer wrong",
      "Basic workflow-token",
      "Bearer token with spaces",
    ]) {
      const response = await app.request(path, {
        ...(method ? { method } : {}),
        headers: authorization ? { Authorization: authorization } : {},
      });

      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: message });
    }
  },
);

test.each(routes)(
  "$path rejects credentials when the server token is empty",
  async ({ path, method, message }) => {
    vi.stubEnv("WORKFLOW_API_TOKEN", "");
    const response = await app.request(path, {
      ...(method ? { method } : {}),
      headers: { Authorization: "Bearer workflow-token" },
    });

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: message });
  },
);

test("authorized requests reach downstream validation without turning 400 into 401", async () => {
  vi.stubEnv("WORKFLOW_API_TOKEN", "workflow-token");
  const file = await app.request(routes[0]!.path, {
    headers: { Authorization: "Bearer workflow-token" },
  });
  const invalidRegistration = await app.request("/internal/external-tasks", {
    method: "POST",
    headers: { Authorization: "Bearer workflow-token" },
  });

  assert.equal(await file.text(), "skill");
  assert.equal(invalidRegistration.status, 400);
  assert.deepEqual(await invalidRegistration.json(), {
    error: "Invalid external task registration",
  });
});
