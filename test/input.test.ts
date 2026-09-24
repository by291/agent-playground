import { describe, expect, it } from "vitest";
import { parseAgentInput } from "../src/input.js";

const baseInput = {
  threadId: "thread-1",
  runId: "run-1",
  messages: [{ id: "message-1", role: "user", content: "Hello" }],
};

describe("parseAgentInput", () => {
  it("uses only the latest user turn because prior turns are checkpointed", () => {
    const input = parseAgentInput({
      ...baseInput,
      messages: [
        { id: "message-0", role: "user", content: "Earlier" },
        { id: "answer-0", role: "assistant", content: "Earlier answer" },
        { id: "message-1", role: "user", content: "Hello" },
      ],
    });

    expect(input).toEqual({
      threadId: "thread-1",
      runId: "run-1",
      messageId: "message-1",
      message: "Hello",
    });
  });

  it("rejects a run without a new user message", () => {
    expect(() => parseAgentInput({ ...baseInput, messages: [] })).toThrow("last message");
  });

  it("rejects protocol features the runtime does not process", () => {
    expect(() => parseAgentInput({
      ...baseInput,
      context: [{ description: "location", value: "Paris" }],
    })).toThrow("not supported");
  });
});
