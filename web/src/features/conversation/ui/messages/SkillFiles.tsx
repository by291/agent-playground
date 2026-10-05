import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import {
  skillFileUrl,
  skillScriptResultSchema,
  type SkillFile,
} from "@shared/skill-files";
import type { toolProcess } from "../../model/turns";
import { AnimatePresence } from "motion/react";
import { AnimatedDiv } from "@/components/ui/motion";
import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@/components/ui/attachment";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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

  return (
    <div
      className="flex flex-wrap gap-2 empty:hidden"
      aria-label="Generated files"
    >
      <AnimatePresence initial={false}>
        {[...files.values()].map((file) => (
          <FileLink key={file.id} file={file} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function FileLink({ file }: { file: SkillFile }) {
  const size = `${Math.ceil(file.size / 1024)} KB`;

  return (
    <AnimatedDiv className="max-w-full min-w-0">
      <Attachment size="sm" className="flex-nowrap border-line">
        <AttachmentMedia>
          <DownloadSimpleIcon size={17} aria-hidden="true" />
        </AttachmentMedia>
        <AttachmentContent className="max-w-64">
          <AttachmentTitle>{file.name}</AttachmentTitle>
          <AttachmentDescription>{size}</AttachmentDescription>
        </AttachmentContent>
        <Tooltip>
          <TooltipTrigger asChild>
            <AttachmentTrigger asChild>
              <a
                href={skillFileUrl(file)}
                download={file.name}
                aria-label={`Download ${file.name}, ${size}`}
              />
            </AttachmentTrigger>
          </TooltipTrigger>
          <TooltipContent>{file.name}</TooltipContent>
        </Tooltip>
      </Attachment>
    </AnimatedDiv>
  );
}
