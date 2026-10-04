export function scrollHistory() {
  return Array.from({ length: 3 }, (_, turn) => [
    {
      id: `user-${turn}`,
      role: "user" as const,
      type: "human" as const,
      content: `Saved question ${turn}`,
    },
    {
      id: `assistant-${turn}`,
      role: "assistant" as const,
      type: "ai" as const,
      content:
        Array.from(
          { length: 8 },
          (_, paragraph) =>
            `Paragraph ${paragraph}: This saved reply contains enough text to exercise scrolling through a long conversation without changing its layout.`,
        ).join("\n\n") +
        "\n\n```typescript\n" +
        Array.from(
          { length: 10 },
          (_, line) => `const value${line} = ${line};`,
        ).join("\n") +
        "\n```",
    },
  ]).flat();
}
