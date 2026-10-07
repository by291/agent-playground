import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  maxSkillFileBytes,
  skillFilenameSchema,
} from "../../shared/skill-files";
import { SubmissionError } from "../conversation/errors";
import { readSkillFile, storeSkillFile } from "../conversation/skill-files";
import { imagePreview } from "../conversation/images";
import { logger } from "../observability/logger";
import { workflowAuth } from "./workflow-auth";

export const skillFileRoutes = new Hono();
const threadSchema = z.string().min(1).max(256);
const idSchema = z.string().uuid();

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
    const name = (() => {
      try {
        return decodeURIComponent(context.req.header("X-Filename") ?? "");
      } catch {
        return "";
      }
    })();
    const input = z
      .object({
        id: idSchema,
        threadId: threadSchema,
        name: skillFilenameSchema,
      })
      .safeParse({
        id: context.req.header("X-File-Id"),
        threadId: context.req.param("threadId"),
        name,
      });

    if (!input.success) {
      return context.json({ error: "Invalid file name or identity" }, 400);
    }

    const file = await storeSkillFile({
      ...input.data,
      data: Buffer.from(await context.req.arrayBuffer()),
    });

    return context.json(file, 201);
  },
);

skillFileRoutes.post(
  "/internal/skill-files",
  bodyLimit({ maxSize: Math.ceil((maxSkillFileBytes * 4) / 3) + 4096 }),
  async (context) => {
    const input = z
      .object({
        id: idSchema,
        threadId: threadSchema,
        runId: z.string().min(1).max(256),
        name: skillFilenameSchema,
        dataBase64: z
          .string()
          .regex(
            /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
          ),
      })
      .strict()
      .safeParse(await context.req.json().catch(() => null));

    if (!input.success) {
      return context.json({ error: "Invalid script output file" }, 400);
    }

    const { dataBase64, ...metadata } = input.data;
    const file = await storeSkillFile({
      ...metadata,
      data: Buffer.from(dataBase64, "base64"),
    });

    return context.json(file, 201);
  },
);

skillFileRoutes.get("/internal/skill-files/:fileId", async (context) => {
  const threadId = context.req.query("threadId") ?? "";
  const file = await readSkillFile(threadId, context.req.param("fileId"));

  return context.body(new Uint8Array(file.data), 200, {
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
    const data = await imagePreview(
      file.data,
      context.req.query("size") === "thumbnail",
    );

    return context.body(new Uint8Array(data), 200, {
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

    return context.body(new Uint8Array(file.data), 200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(file.name).replaceAll("'", "%27")}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    });
  },
);
