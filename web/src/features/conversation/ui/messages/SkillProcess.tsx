import type { ReactNode } from "react";
import type { toolProcess, ToolStep } from "../../model/turns";
import { ToolProcess } from "./ToolProcess";
import { skillIdentity } from "../../model/skillExecution";
import { isMemoryTool } from "../../model/memoryExecution";

export function ExecutionProcess({
  process,
  children,
}: {
  process: ReturnType<typeof toolProcess>;
  children?: ReactNode;
}) {
  const groups = new Map<string, ReturnType<typeof toolProcess>>();
  const tools: ReturnType<typeof toolProcess> = [];
  const memories: ReturnType<typeof toolProcess> = [];

  for (const entry of process) {
    const byCategory = new Map<string, ToolStep[]>();

    for (const step of entry.calls) {
      const skill = skillIdentity(step);
      let category = "tool";

      if (isMemoryTool(step.call.function.name)) {
        category = "memory";
      } else if (skill) {
        category = `skill:${skill.name}`;
      }

      const steps = byCategory.get(category) ?? [];

      steps.push(step);
      byCategory.set(category, steps);
    }

    let first = true;

    for (const [category, calls] of byCategory) {
      // An assistant note accompanying mixed calls belongs to its first group only.
      const message = first ? entry.message : { ...entry.message, content: "" };

      first = false;

      if (category === "tool") {
        tools.push({ message, calls });
      } else if (category === "memory") {
        memories.push({ message, calls });
      } else {
        const name = category.slice("skill:".length);
        const group = groups.get(name) ?? [];

        group.push({ message, calls });
        groups.set(name, group);
      }
    }
  }

  return (
    <div className="motion-content-enter space-y-2">
      {[...groups].map(([name, entries]) => (
        <ToolProcess key={`skill:${name}`} process={entries} skillName={name} />
      ))}
      {memories.length > 0 && (
        <ToolProcess key="memory" process={memories} category="Memory" />
      )}
      {tools.length > 0 && (
        <ToolProcess process={tools}>{children}</ToolProcess>
      )}
    </div>
  );
}
