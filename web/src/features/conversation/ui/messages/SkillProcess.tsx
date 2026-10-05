import type { ReactNode } from "react";
import type { toolProcess, ToolStep } from "../../model/turns";
import { ToolProcess } from "./ToolProcess";
import { skillIdentity } from "../../model/skillExecution";

export function ExecutionProcess({
  process,
  children,
}: {
  process: ReturnType<typeof toolProcess>;
  children?: ReactNode;
}) {
  const groups = new Map<string, ReturnType<typeof toolProcess>>();
  const tools: ReturnType<typeof toolProcess> = [];

  for (const entry of process) {
    const byCategory = new Map<string, ToolStep[]>();

    for (const step of entry.calls) {
      const category = skillIdentity(step)?.name ?? "";
      const steps = byCategory.get(category) ?? [];

      steps.push(step);
      byCategory.set(category, steps);
    }

    let first = true;

    for (const [name, calls] of byCategory) {
      // An assistant note accompanying mixed calls belongs to its first group only.
      const message = first ? entry.message : { ...entry.message, content: "" };

      first = false;

      if (!name) {
        tools.push({ message, calls });
      } else {
        const group = groups.get(name) ?? [];

        group.push({ message, calls });
        groups.set(name, group);
      }
    }
  }

  return (
    <div className="motion-content-enter space-y-2">
      {[...groups].map(([name, entries]) => (
        <ToolProcess key={name} process={entries} skillName={name} />
      ))}
      {tools.length > 0 && (
        <ToolProcess process={tools}>{children}</ToolProcess>
      )}
    </div>
  );
}
