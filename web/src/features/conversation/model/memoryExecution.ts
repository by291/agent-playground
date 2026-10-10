const memoryTools = new Set([
  "search_memory",
  "remember_memory",
  "forget_memory",
]);

export function isMemoryTool(name: string): boolean {
  return memoryTools.has(name);
}
