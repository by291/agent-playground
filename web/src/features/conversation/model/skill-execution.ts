import type { ToolStep } from "./turns";

const skillTools = new Set([
  "load_skill",
  "read_skill_file",
  "run_skill_script",
]);

export function skillIdentity(
  step: ToolStep,
): { name: string; path?: string } | null {
  if (!skillTools.has(step.call.function.name)) {
    return null;
  }

  try {
    const arguments_: unknown = JSON.parse(step.call.function.arguments);

    if (
      typeof arguments_ === "object" &&
      arguments_ !== null &&
      "skill_name" in arguments_ &&
      typeof arguments_.skill_name === "string" &&
      arguments_.skill_name.trim()
    ) {
      let path: string | undefined;

      if (
        "script_path" in arguments_ &&
        typeof arguments_.script_path === "string"
      ) {
        path = arguments_.script_path;
      } else if ("path" in arguments_ && typeof arguments_.path === "string") {
        path = arguments_.path;
      }

      return { name: arguments_.skill_name, ...(path ? { path } : {}) };
    }
  } catch {
    // A streaming call can identify its category before its arguments are complete.
  }

  return { name: "Loading…" };
}
