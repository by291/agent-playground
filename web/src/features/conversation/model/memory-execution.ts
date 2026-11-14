const memoryTools = new Set([
  "search_memory",
  "remember_memory",
  "forget_memory",
]);

/** Recognizes tool names that the transcript groups as memory operations. */
export function isMemoryTool(name: string): boolean {
  return memoryTools.has(name);
}
