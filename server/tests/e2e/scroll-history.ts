const TURN_COUNT = 3;
const PARAGRAPHS_PER_REPLY = 8;
const CODE_LINES_PER_REPLY = 10;

/** Builds mixed text and code history long enough to exercise the scroll viewport. */
export function scrollHistory() {
  return Array.from({ length: TURN_COUNT }, (_, turn) => [
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
          { length: PARAGRAPHS_PER_REPLY },
          (_, paragraph) =>
            `Paragraph ${paragraph}: This saved reply contains enough text to exercise scrolling through a long conversation without changing its layout.`,
        ).join("\n\n") +
        "\n\n```typescript\n" +
        Array.from(
          { length: CODE_LINES_PER_REPLY },
          (_, line) => `const value${line} = ${line};`,
        ).join("\n") +
        "\n```",
    },
  ]).flat();
}
