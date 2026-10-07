import type { InputContent, Message, RunAgentInput } from "@ag-ui/client";
import { imageMimeType, validateImage } from "./images";
import { uploadedFileReferences } from "../../shared/uploaded-files";
import { SubmissionError } from "./errors";
import { readSkillFile } from "./skill-files";

const maxImageBatchBytes = 32 * 1024 * 1024;

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

  if (references.length > 4) {
    throw new SubmissionError("Use at most four uploaded files", 400);
  }

  const files = await Promise.all(
    references.map(async (reference) => {
      // This read verifies publication, conversation ownership and the stored digest.
      const file = await readSkillFile(input.threadId, reference.id);

      if (file.name !== reference.name) {
        throw new SubmissionError(
          "Attachment name does not match the stored file",
          400,
        );
      }

      const mimeType = imageMimeType(file.data);

      if (
        !mimeType &&
        /\.(jpe?g|png|gif|webp|svg|bmp|avif|heic|heif|tiff?)$/i.test(file.name)
      ) {
        throw new SubmissionError(
          "Attach a valid JPEG, PNG, GIF or WebP image",
          400,
        );
      }

      return { ...file, mimeType };
    }),
  );
  const images = files.filter((file) => file.mimeType !== null);

  if (!images.length) {
    return input;
  }

  if (input.resume?.length) {
    throw new SubmissionError(
      "Image attachments are supported in regular chat; use text for workflow review feedback",
      400,
    );
  }

  const totalBytes = images.reduce((size, file) => size + file.data.length, 0);

  if (totalBytes > maxImageBatchBytes) {
    throw new SubmissionError(
      "Image attachments must total at most 32 MiB per message",
      400,
    );
  }

  // Decode one image at a time to bound concurrent pixel-processing memory.
  for (const file of images) {
    await validateImage(file.data);
  }

  // Keep references in the admission/archive and inline bytes only in model input.
  // Private/local S3 URLs cannot be fetched by the model provider.
  const content: InputContent[] = [
    { type: "text", text: userMessage.content },
    ...images.map((file): InputContent => ({
      type: "image",
      source: {
        type: "data",
        mimeType: file.mimeType!,
        value: file.data.toString("base64"),
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
