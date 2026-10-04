import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import {
  skillFileUrl,
  skillScriptResultSchema,
  type SkillFile,
} from "@shared/skill-files";
import type { toolProcess } from "../../model/turns";

export function SkillFiles({
  process,
}: {
  process: ReturnType<typeof toolProcess>;
}) {
  const files = new Map<string, SkillFile>();

  for (const step of process.flatMap((entry) => entry.calls)) {
    if (step.call.function.name !== "run_skill_script" || !step.result) {
      continue;
    }

    try {
      const result = skillScriptResultSchema.safeParse(
        JSON.parse(step.result.content),
      );

      if (result.success) {
        for (const file of result.data.files) {
          files.set(file.id, file);
        }
      }
    } catch {
      // Legacy or interrupted results may not contain complete file metadata.
    }
  }

  if (!files.size) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2" aria-label="Generated files">
      {[...files.values()].map((file) => (
        <a
          key={file.id}
          href={skillFileUrl(file)}
          download={file.name}
          className="inline-flex max-w-full items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm hover:bg-sidebar focus-visible:ring-2 focus-visible:ring-accent"
        >
          <DownloadSimpleIcon size={17} aria-hidden="true" />
          <span className="truncate">{file.name}</span>
          <span className="text-xs text-muted">
            {Math.ceil(file.size / 1024)} KB
          </span>
        </a>
      ))}
    </div>
  );
}
