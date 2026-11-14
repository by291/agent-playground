import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  maxSkillFileBytes,
  skillFilenameSchema,
} from "../../../shared/skill-files.js";
import { SubmissionError } from "../conversation/errors.js";
import { imagePreview } from "../conversation/files/image-processing.js";
import {
  readSkillFile,
  storeSkillFile,
} from "../conversation/files/skill-files.js";
import { workflowAuth } from "../middleware/workflow-auth.js";
import { logger } from "../observability/logger.js";
import { attachmentDisposition } from "./content-disposition.js";

const maxUploadIdentityLength = 256;
const base64OutputGroupSize = 4;
const base64InputGroupSize = 3;
const scriptUploadMetadataBytes = 4_096;
const maxScriptUploadBytes =
  Math.ceil(
    (maxSkillFileBytes * base64OutputGroupSize) / base64InputGroupSize,
  ) + scriptUploadMetadataBytes;

const uploadIdentitySchema = z.string().min(1).max(maxUploadIdentityLength);
const fileUploadSchema = z.object({
  id: z.string().uuid(),
  threadId: uploadIdentitySchema,
  name: skillFilenameSchema,
});
const scriptUploadSchema = fileUploadSchema
  .extend({
    runId: uploadIdentitySchema,
    dataBase64: z
      .string()
      .regex(
        /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
      ),
  })
  .strict();

/** Serves user and workflow file uploads, downloads and image previews. */
export const skillFileRoutes = new Hono();

skillFileRoutes.onError((error, context) => {
  if (error instanceof HTTPException) {
    return error.getResponse();
  }

  if (error instanceof SubmissionError) {
    return context.json({ error: error.message }, error.status);
  }

  logger.error({ err: error }, "Skill file request failed");

  return context.json({ error: "File storage is unavailable" }, 503);
});

skillFileRoutes.use(
  "/internal/skill-files",
  workflowAuth("Invalid workflow credential"),
);
skillFileRoutes.use(
  "/internal/skill-files/*",
  workflowAuth("Invalid workflow credential"),
);

skillFileRoutes.post(
  "/conversations/:threadId/files",
  bodyLimit({ maxSize: maxSkillFileBytes }),
  async (context) => {
    let name: string;

    try {
      name = decodeURIComponent(context.req.header("X-Filename") ?? "");
    } catch {
      name = "";
    }

    const input = fileUploadSchema.safeParse({
      id: context.req.header("X-File-Id"),
      threadId: context.req.param("threadId"),
      name,
    });

    if (!input.success) {
      return context.json({ error: "Invalid file name or identity" }, 400);
    }

    const bytes = Buffer.from(await context.req.arrayBuffer());
    const file = await storeSkillFile({
      ...input.data,
      bytes,
    });

    return context.json(file, 201);
  },
);

skillFileRoutes.post(
  "/internal/skill-files",
  bodyLimit({ maxSize: maxScriptUploadBytes }),
  async (context) => {
    const requestBody: unknown = await context.req.json().catch(() => null);
    const input = scriptUploadSchema.safeParse(requestBody);

    if (!input.success) {
      return context.json({ error: "Invalid script output file" }, 400);
    }

    const { dataBase64: encodedBytes, ...metadata } = input.data;
    const file = await storeSkillFile({
      ...metadata,
      bytes: Buffer.from(encodedBytes, "base64"),
    });

    return context.json(file, 201);
  },
);

skillFileRoutes.get("/internal/skill-files/:fileId", async (context) => {
  const threadId = context.req.query("threadId") ?? "";
  const file = await readSkillFile(threadId, context.req.param("fileId"));

  return context.body(new Uint8Array(file.bytes), 200, {
    "Content-Type": "application/octet-stream",
    "X-Filename": encodeURIComponent(file.name),
    "Cache-Control": "no-store",
  });
});

skillFileRoutes.get(
  "/conversations/:threadId/files/:fileId/preview",
  async (context) => {
    const file = await readSkillFile(
      context.req.param("threadId"),
      context.req.param("fileId"),
    );
    const previewBytes = await imagePreview(file.bytes, {
      isThumbnail: context.req.query("size") === "thumbnail",
    });

    return context.body(new Uint8Array(previewBytes), 200, {
      "Content-Type": "image/webp",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    });
  },
);

skillFileRoutes.get(
  "/conversations/:threadId/files/:fileId",
  async (context) => {
    const file = await readSkillFile(
      context.req.param("threadId"),
      context.req.param("fileId"),
    );

    return context.body(new Uint8Array(file.bytes), 200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": attachmentDisposition(file.name, "download"),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    });
  },
);
