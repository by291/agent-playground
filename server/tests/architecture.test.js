import assert from "node:assert/strict";
import path from "node:path";
import { Linter } from "eslint";
import { test } from "vitest";
import { architectureRule } from "../eslint.architecture.js";

const root = path.resolve(import.meta.dirname, "../src");

function lint(file, code) {
  return new Linter().verify(
    code,
    {
      plugins: { architecture: { rules: { boundaries: architectureRule } } },
      rules: { "architecture/boundaries": "error" },
    },
    { filename: path.join(root, file) },
  );
}

test("database, storage and telemetry cannot import application capabilities", () => {
  for (const [file, code] of [
    ["db/example.js", 'import { app } from "../app.js";'],
    [
      "storage/example.js",
      'export { run } from "../conversation/runs/run-dispatch.js";',
    ],
    [
      "observability/example.js",
      'const routes = import("../routes/agent-routes.js");',
    ],
  ]) {
    assert.equal(lint(file, code).length, 1, `${file}: ${code}`);
  }
});

test("business code and upstream agents cannot depend on HTTP transport", () => {
  for (const [file, code] of [
    ["agent/example.js", 'import { stream } from "../routes/run-stream.js";'],
    ["conversation/runs/example.js", 'import { app } from "../../app.js";'],
    [
      "knowledge/example.js",
      'import { auth } from "../middleware/workflow-auth.js";',
    ],
    ["memory/example.js", 'import { Hono } from "hono";'],
    [
      "conversation/history/example.js",
      'export { streamSSE } from "hono/streaming";',
    ],
  ]) {
    assert.equal(lint(file, code).length, 1, `${file}: ${code}`);
  }
});

test("routes compose capabilities and capabilities use database and upstream adapters", () => {
  for (const [file, code] of [
    [
      "routes/example.js",
      'import { run } from "../conversation/runs/run-dispatch.js";',
    ],
    [
      "conversation/runs/example.js",
      'import { db } from "../../db/database.js";',
    ],
    [
      "conversation/runs/example.js",
      'import { agent } from "../../agent/run-execution.js";',
    ],
    ["db/example.js", 'import { logger } from "../observability/logger.js";'],
    ["app.js", 'import { routes } from "./routes/agent-routes.js";'],
    [
      "middleware/example.js",
      'import { createMiddleware } from "hono/factory";',
    ],
  ]) {
    assert.deepEqual(lint(file, code), [], `${file}: ${code}`);
  }
});
