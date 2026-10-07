import { z } from "zod";
import { skillFilenameSchema, type SkillFile } from "./skill-files";

const marker = "\n\nUploaded files:\n";
const referenceSchema = z.object({
  id: z.string().uuid(),
  name: skillFilenameSchema,
});
type FileReference = Pick<SkillFile, "id" | "name">;

export function uploadedFileMessage(
  text: string,
  files: FileReference[],
): string {
  if (!files.length) {
    return text;
  }

  const references = files.map(
    (file) => `${JSON.stringify(file.name)} — File ID: ${file.id}`,
  );

  return `${text}${marker}${references.join("\n")}`;
}

export function uploadedFileReferences(content: string): FileReference[] {
  return uploadedMessageContent(content).files;
}

export function uploadedMessageContent(content: string): {
  text: string;
  files: FileReference[];
} {
  const start = content.lastIndexOf(marker);
  const plain = { text: content, files: [] };

  if (start < 0) {
    return plain;
  }

  const references: FileReference[] = [];

  // Recognize only the complete trailing envelope emitted by the composers.
  // Mentioning a file ID elsewhere in a prompt must not load that file.
  for (const line of content.slice(start + marker.length).split("\n")) {
    const match = /^(".*") — File ID: ([\da-f-]+)$/i.exec(line);

    if (!match) {
      return plain;
    }

    let name: unknown;

    try {
      name = JSON.parse(match[1]!);
    } catch {
      return plain;
    }

    const parsed = referenceSchema.safeParse({ name, id: match[2] });

    if (!parsed.success) {
      return plain;
    }

    references.push(parsed.data);
  }

  return { text: content.slice(0, start), files: references };
}
