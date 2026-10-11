import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { maxKnowledgeBytes } from "../../../shared/knowledge.js";
import {
  changeDocument,
  KnowledgeError,
  listDocuments,
  parseTextEncoding,
  readDocument,
  uploadDocument,
} from "../knowledge/documents.js";
import { logger } from "../observability/logger.js";
import { workflowAuth } from "../middleware/workflow-auth.js";

export const knowledgeRoutes = new Hono();

knowledgeRoutes.onError((error, context) => {
  if (error instanceof HTTPException) {
    return error.getResponse();
  }

  if (error instanceof KnowledgeError) {
    return context.json({ error: error.message }, error.status);
  }

  logger.error({ err: error }, "Knowledge document request failed");

  return context.json({ error: "Document storage is unavailable" }, 503);
});

knowledgeRoutes.use(
  "/internal/knowledge/*",
  workflowAuth("Invalid application credential"),
);

knowledgeRoutes.get("/api/knowledge/documents", async (context) =>
  context.json(await listDocuments()),
);
knowledgeRoutes.post(
  "/api/knowledge/documents",
  bodyLimit({ maxSize: maxKnowledgeBytes }),
  async (context) => {
    let name: string;

    try {
      name = decodeURIComponent(context.req.header("X-Filename") ?? "");
    } catch {
      return context.json({ error: "Invalid file name" }, 400);
    }

    const document = await uploadDocument(
      context.req.header("X-Document-Id") ?? "",
      name,
      Buffer.from(await context.req.arrayBuffer()),
      parseTextEncoding(context.req.header("X-Text-Encoding")),
    );

    return context.json(document, 201);
  },
);
knowledgeRoutes.post(
  "/api/knowledge/documents/:id/reindex",
  async (context) => {
    const document = await changeDocument(
      context.req.param("id"),
      "reindex",
      parseTextEncoding(context.req.header("X-Text-Encoding")),
    );

    return context.json(document);
  },
);
knowledgeRoutes.delete("/api/knowledge/documents/:id", async (context) => {
  await changeDocument(context.req.param("id"), "delete");

  return context.body(null, 204);
});

for (const path of [
  "/api/knowledge/documents/:id/file",
  "/internal/knowledge/documents/:id/file",
]) {
  knowledgeRoutes.get(path, async (context) => {
    const file = await readDocument(context.req.param("id") ?? "");

    return context.body(new Uint8Array(file.data), 200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="document"; filename*=UTF-8''${encodeURIComponent(file.name).replaceAll("'", "%27")}`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
  });
}
