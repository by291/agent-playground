// @vitest-environment jsdom
import { createElement } from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { MessageRow } from "./MessageRow";
import { AssistantReply } from "./AssistantReply";
import { animationClock } from "../../../../../tests/animationClock";

test("message dates use local time and invalid or absent dates stay hidden", () => {
  const page = render(
    createElement(MessageRow, {
      message: { id: "question", role: "user", content: "Question" },
      timestamp: "2026-10-10T18:00:00.000Z",
    }),
  );
  const time = page.container.querySelector("time")!;

  expect(time).toHaveAttribute("datetime", "2026-10-10T18:00:00.000Z");
  expect(time.textContent).toContain(
    new Date("2026-10-10T18:00:00.000Z").getHours().toString().padStart(2, "0"),
  );
  page.rerender(
    createElement(MessageRow, {
      message: { id: "question", role: "user", content: "Question" },
      timestamp: "invalid",
    }),
  );
  expect(page.container.querySelector("time")).toBeNull();
});

test("Copy all writes the original Markdown and reports clipboard rejection", async () => {
  const copied: string[] = [];
  let rejectCopy = false;

  vi.stubGlobal("navigator", {
    clipboard: {
      writeText: (text: string) => {
        if (rejectCopy) {
          return Promise.reject(new Error("Permission denied"));
        }

        copied.push(text);

        return Promise.resolve();
      },
    },
  });
  const markdown = "## Reply\n\nA **bold** [link](https://example.com).";
  const page = render(
    createElement(MessageRow, {
      message: { id: "reply", role: "assistant", content: markdown },
    }),
  );

  fireEvent.click(page.getByRole("button", { name: "Copy all" }));
  await waitFor(() =>
    expect(page.getByRole("button", { name: "Copied" })).toBeEnabled(),
  );
  expect(copied).toEqual([markdown]);
  rejectCopy = true;
  fireEvent.click(page.getByRole("button", { name: "Copied" }));
  await waitFor(() =>
    expect(page.getByRole("status")).toHaveTextContent("Could not copy"),
  );
  expect(copied).toEqual([markdown]);
});

test("Copy all stays disabled through streaming and the remaining display buffer", async () => {
  const clock = animationClock();
  const turn = {
    id: "question",
    user: null,
    messages: [
      {
        id: "reply",
        role: "assistant" as const,
        content: "A lengthy answer. ".repeat(30),
      },
    ],
    status: "running" as const,
  };
  const page = render(
    createElement(AssistantReply, { turn, animatedMessageId: "reply" }),
  );

  expect(page.getByRole("button", { name: "Copy all" })).toBeDisabled();
  clock.advance(16);
  await act(() => Promise.resolve());
  page.rerender(
    createElement(AssistantReply, {
      turn: { ...turn, status: "completed" },
      animatedMessageId: "reply",
    }),
  );
  expect(page.getByRole("button", { name: "Copy all" })).toBeDisabled();
  clock.advance(4000);
  await act(() => Promise.resolve());
  expect(page.getByRole("button", { name: "Copy all" })).toBeEnabled();
});

test("reply selections preserve fenced code, tables and partial inline formatting", async () => {
  const page = render(
    createElement(MessageRow, {
      message: {
        id: "reply",
        role: "assistant",
        content:
          "A **bold** word.\n\n```js\nconst a = 1;\nconsole.log(a);\n```\n\n| Name | Value |\n| --- | --- |\n| Item | 1 |",
      },
    }),
  );

  await waitFor(() =>
    expect(
      page.container.querySelectorAll("code span[style]").length,
    ).toBeGreaterThan(0),
  );
  const answer = page.container.querySelector(".chat-markdown")!;
  const selection = window.getSelection()!;
  const range = document.createRange();

  range.selectNodeContents(answer);
  selection.removeAllRanges();
  selection.addRange(range);
  const clipboard = new Map<string, string>();
  const copy = () => {
    const event = new Event("copy", { bubbles: true, cancelable: true });

    Object.defineProperty(event, "clipboardData", {
      value: {
        setData: (type: string, text: string) => clipboard.set(type, text),
      },
    });
    fireEvent(answer, event);
  };

  copy();
  expect(clipboard.get("text/plain")).toContain(
    "```js\nconst a = 1;\nconsole.log(a);\n```",
  );
  expect(clipboard.get("text/plain")).toContain(
    "| Name | Value |\n| --- | --- |\n| Item | 1 |",
  );
  expect(clipboard.get("text/plain")).not.toContain("Copy Code");

  const bold = answer.querySelector('[data-streamdown="strong"]')!.firstChild!;

  range.setStart(bold, 1);
  range.setEnd(bold, 3);
  selection.removeAllRanges();
  selection.addRange(range);
  copy();
  expect(clipboard.get("text/plain")).toBe("**ol**");
  selection.removeAllRanges();
});

test("copying a reply selection preserves Markdown formatting across blocks", () => {
  const page = render(
    createElement(MessageRow, {
      message: {
        id: "reply",
        role: "assistant",
        content:
          "A **bold** [link](https://example.com).\n\n> Another paragraph.",
      },
    }),
  );
  const answer = page.container.querySelector(".chat-markdown")!;
  const range = document.createRange();

  range.selectNodeContents(answer);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  const clipboard = new Map<string, string>();
  const event = new Event("copy", { bubbles: true, cancelable: true });

  Object.defineProperty(event, "clipboardData", {
    value: {
      setData: (type: string, text: string) => clipboard.set(type, text),
    },
  });

  fireEvent(answer, event);

  expect(event.defaultPrevented).toBe(true);
  expect(clipboard.get("text/plain")).toBe(
    "A **bold** [link](https://example.com).\n\n> Another paragraph.",
  );
  window.getSelection()!.removeAllRanges();
});

test("a selected table cell retains its table and quote context with escaped pipes", () => {
  const page = render(
    createElement(MessageRow, {
      message: {
        id: "reply",
        role: "assistant",
        content: "> | Header |\n> | --- |\n> | `left\\|right` |",
      },
    }),
  );
  const answer = page.container.querySelector(".chat-markdown")!;
  const range = document.createRange();

  range.selectNodeContents(answer.querySelector("td")!);
  const selection = window.getSelection()!;

  selection.removeAllRanges();
  selection.addRange(range);
  const clipboard = new Map<string, string>();
  const event = new Event("copy", { bubbles: true, cancelable: true });

  Object.defineProperty(event, "clipboardData", {
    value: {
      setData: (type: string, text: string) => clipboard.set(type, text),
    },
  });

  fireEvent(answer, event);

  expect(clipboard.get("text/plain")).toBe(
    "> |  |\n> | --- |\n> | `left\\|right` |",
  );
  selection.removeAllRanges();
});

test.each([
  {
    source: "| Header |\n| --- |\n| A \\*star\\* |",
    expected: "| Header |\n| --- |\n| A \\*star\\* |",
  },
  {
    source: "| Header |\n| --- |\n| `a\\b` |",
    expected: "| Header |\n| --- |\n| `a\\b` |",
  },
  {
    source: "[Link](<https://example.com/a)b>)",
    expected: "[Link](https://example.com/a\\)b)",
  },
])("selected Markdown preserves escapes in $source", ({ source, expected }) => {
  const page = render(
    createElement(MessageRow, {
      message: { id: "reply", role: "assistant", content: source },
    }),
  );
  const answer = page.container.querySelector(".chat-markdown")!;
  const range = document.createRange();

  range.selectNodeContents(answer);
  const selection = window.getSelection()!;

  selection.removeAllRanges();
  selection.addRange(range);
  const clipboard = new Map<string, string>();
  const event = new Event("copy", { bubbles: true, cancelable: true });

  Object.defineProperty(event, "clipboardData", {
    value: {
      setData: (type: string, text: string) => clipboard.set(type, text),
    },
  });

  fireEvent(answer, event);

  expect(clipboard.get("text/plain")).toBe(expected);
  const pasted = render(
    createElement(MessageRow, {
      message: {
        id: "pasted",
        role: "assistant",
        content: clipboard.get("text/plain")!,
      },
    }),
  );
  const table = answer.querySelector("table");
  const link = answer.querySelector("[data-markdown-href]");

  if (table) {
    expect(pasted.container.querySelector("table")?.textContent).toBe(
      table.textContent,
    );
  }

  if (link) {
    expect(
      pasted.container
        .querySelector("[data-markdown-href]")
        ?.getAttribute("data-markdown-href"),
    ).toBe("https://example.com/a)b");
  }

  selection.removeAllRanges();
});
