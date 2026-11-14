import type { ContentPart, Message, RunAgentInput } from "@ag-ui/client";
import { uploadedFileReferences } from "../../../../shared/uploaded-files.js";
import { SubmissionError } from "../errors.js";
import { imageMimeType, validateImage } from "./image-processing.js";
import { readSkillFile } from "./skill-files.js";

const maxImageBatchBytes = 32 * 1024 * 1024;
const maxFileReferences = 4;
const imageExtension = /\.(jpe?g|png|gif|webp|svg|bmp|avif|heic|heif|tiff?)$/i;

async function readAttachment(
  threadId: string,
  reference: { id: string; name: string },
) {
  // This read verifies publication, conversation ownership and the stored digest.
  const file = await readSkillFile(threadId, reference.id);

  if (file.name !== reference.name) {
    throw new SubmissionError(
      "Attachment name does not match the stored file",
      400,
    );
  }

  const mimeType = imageMimeType(file.bytes);
  const isInvalidImage = !mimeType && imageExtension.test(file.name);

  if (isInvalidImage) {
    throw new SubmissionError(
      "Attach a valid JPEG, PNG, GIF or WebP image",
      400,
    );
  }

  return { bytes: file.bytes, mimeType };
}

/** Inlines verified image attachments in the latest user message sent to the model. */
export async function prepareImageInput(
  input: RunAgentInput,
  userMessage: Message,
): Promise<RunAgentInput> {
  if (typeof userMessage.content !== "string") {
    return input;
  }

  const references = uploadedFileReferences(userMessage.content);

  if (!references.length) {
    return input;
  }

  if (references.length > maxFileReferences) {
    throw new SubmissionError("Use at most four uploaded files", 400);
  }

  const files = await Promise.all(
    references.map((reference) => readAttachment(input.threadId, reference)),
  );
  const images = files.filter(
    (file): file is { bytes: Buffer; mimeType: string } =>
      file.mimeType !== null,
  );

  if (!images.length) {
    return input;
  }

  if (input.resume?.length) {
    throw new SubmissionError(
      "Image attachments are supported in regular chat; use text for workflow review feedback",
      400,
    );
  }

  const totalBytes = images.reduce((size, file) => size + file.bytes.length, 0);

  if (totalBytes > maxImageBatchBytes) {
    throw new SubmissionError(
      "Image attachments must total at most 32 MiB per message",
      400,
    );
  }

  // Decode one image at a time to bound concurrent pixel-processing memory.
  for (const file of images) {
    await validateImage(file.bytes);
  }

  // Keep references in the admission/archive and inline bytes only in model input.
  // Private/local S3 URLs cannot be fetched by the model provider.
  const content: ContentPart[] = [
    { type: "text", text: userMessage.content },
    ...images.map((file): ContentPart => ({
      type: "image",
      source: {
        type: "data",
        mimeType: file.mimeType,
        value: file.bytes.toString("base64"),
      },
    })),
  ];

  return {
    ...input,
    messages: input.messages.map((message) =>
      message.role === "user" && message.id === userMessage.id
        ? { ...message, content }
        : message,
    ),
  };
}
