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
  const start = content.lastIndexOf(marker);

  if (start < 0) {
    return [];
  }

  const references: FileReference[] = [];

  // Recognize only the complete trailing envelope emitted by the composers.
  // Mentioning a file ID elsewhere in a prompt must not load that file.
  for (const line of content.slice(start + marker.length).split("\n")) {
    const match = /^(".*") — File ID: ([\da-f-]+)$/i.exec(line);

    if (!match) {
      return [];
    }

    let name: unknown;

    try {
      name = JSON.parse(match[1]!);
    } catch {
      return [];
    }

    const parsed = referenceSchema.safeParse({ name, id: match[2] });

    if (!parsed.success) {
      return [];
    }

    references.push(parsed.data);
  }

  return references;
}
