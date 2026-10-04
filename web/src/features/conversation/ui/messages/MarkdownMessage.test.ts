// @vitest-environment jsdom
import { test, onTestFinished, vi, expect } from "vitest";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import MarkdownMessage from "./MarkdownMessage";
import { UserPreferencesProvider, useUserPreferences } from "@/lib/preferences";
import {
  ReplyPresentationProvider,
  useReplyPresentationBusy,
} from "../ReplyPresentation";

test("code blocks highlight syntax and copy the original source", async () => {
  const source = "int main(void) {\n  return 0;\n}\n";
  const copied: string[] = [];
  const clipboardDescriptor = Object.getOwnPropertyDescriptor(
    navigator,
    "clipboard",
  );

  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: (text: string) => {
        copied.push(text);

        return Promise.resolve();
      },
    },
  });
  onTestFinished(() => {
    if (clipboardDescriptor) {
      Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
    } else {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  const page = render(
    createElement(MarkdownMessage, {
      text: `\`\`\`c\n${source}\`\`\``,
      streaming: false,
    }),
  );

  await waitFor(() => {
    const tokens = page.container.querySelectorAll(
      '[data-streamdown="code-block"] span[style*="--sdm-c:"]',
    );

    assert.ok(
      [...tokens].some((token) => token.getAttribute("style")?.includes("#")),
      "Code tokens must receive syntax colors after the language loads",
    );
  });

  fireEvent.click(page.getByRole("button", { name: "Copy Code" }));
  await waitFor(() => {
    assert.deepEqual(copied, [source]);
  });

  assert.ok(page.getByRole("button", { name: "Download file" }));
});

function animationClock() {
  let now = 0;
  let nextId = 0;
  const frames = new Map<number, FrameRequestCallback>();

  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = ++nextId;

    frames.set(id, callback);

    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));

  return {
    frames,
    advance(duration: number) {
      const end = now + duration;

      while (now < end) {
        const elapsed = Math.min(end - now, 34);

        now += elapsed;
        const pending = [...frames.values()];

        frames.clear();
        act(() => {
          vi.advanceTimersByTime(elapsed);

          for (const callback of pending) {
            callback(now);
          }
        });
      }
    },
  };
}

test("disabling reply animation during a stream reveals received text and releases its scheduler", () => {
  const clock = animationClock();
  const text = "Display the received reply immediately. ".repeat(30).trim();

  function PreferencesToggle() {
    const { updatePreferences } = useUserPreferences();

    return createElement("button", {
      onClick: () => updatePreferences({ replyAnimation: false }),
      children: "Disable reply animation",
    });
  }

  const page = render(
    createElement(UserPreferencesProvider, {
      children: [
        createElement(PreferencesToggle, { key: "preferences" }),
        createElement(MarkdownMessage, { key: "reply", text, streaming: true }),
      ],
    }),
  );

  clock.advance(340);
  expect(page.queryByText(text)).toBeNull();
  fireEvent.click(
    page.getByRole("button", { name: "Disable reply animation" }),
  );
  expect(page.getByText(text)).toBeVisible();
  expect(clock.frames.size).toBe(0);
  expect(page.container.querySelectorAll("[data-sd-animate]").length).toBe(0);
});

test("live bursts reveal gradually and continue draining after the source finishes", () => {
  const clock = animationClock();
  const text = "清晨的城市逐渐醒来，人们走向各自的生活。".repeat(30);
  const page = render(
    createElement(MarkdownMessage, { text, streaming: true }),
  );

  assert.ok((page.container.textContent?.length ?? 0) < text.length);
  clock.advance(340);
  const opening = page.container.textContent ?? "";

  assert.ok(opening.length > 0 && opening.length < text.length);
  page.rerender(createElement(MarkdownMessage, { text, streaming: false }));

  assert.equal(page.container.textContent, opening);
  clock.advance(340);
  const draining = page.container.textContent ?? "";

  assert.ok(draining.length > opening.length && draining.length < text.length);
  clock.advance(10_000);

  assert.equal(page.container.textContent, text);
  assert.equal(clock.frames.size, 0);
  assert.equal(page.container.querySelectorAll("[data-sd-animate]").length, 0);
});

test("a completed source keeps its final fade mounted until the last reveal settles", () => {
  const clock = animationClock();
  const text = "A calm morning in the city.";
  const page = render(
    createElement(MarkdownMessage, { text, streaming: true }),
  );

  clock.advance(68);
  page.rerender(createElement(MarkdownMessage, { text, streaming: false }));

  for (let tick = 0; tick < 80 && page.container.textContent !== text; tick++) {
    clock.advance(34);
  }

  assert.equal(page.container.textContent, text);
  assert.ok(page.container.querySelector("[data-sd-animate]"));
  clock.advance(499);

  assert.ok(page.container.querySelector("[data-sd-animate]"));
  clock.advance(1);

  assert.equal(page.container.querySelectorAll("[data-sd-animate]").length, 0);
});

test("a fade that already finished does not add another delay when the source completes", () => {
  const clock = animationClock();
  const text = "Hello.";
  const page = render(
    createElement(MarkdownMessage, { text, streaming: true }),
  );

  clock.advance(1000);
  page.rerender(createElement(MarkdownMessage, { text, streaming: false }));
  clock.advance(1);

  assert.equal(page.container.textContent, text);
  assert.equal(page.container.querySelectorAll("[data-sd-animate]").length, 0);
});

test("removed replies release their display locks without unlocking another live reply", () => {
  const clock = animationClock();

  function SendButton() {
    const busy = useReplyPresentationBusy();

    return createElement("button", { disabled: busy }, "Send");
  }

  function replies(ids: string[]) {
    return createElement(ReplyPresentationProvider, {
      children: [
        createElement(SendButton, { key: "send" }),
        ...ids.map((id) =>
          createElement(MarkdownMessage, {
            key: id,
            text: "Live reply".repeat(30),
            streaming: true,
          }),
        ),
      ],
    });
  }

  const page = render(replies(["first", "second"]));
  const button = page.getByRole("button") as HTMLButtonElement;

  assert.equal(button.disabled, true);
  page.rerender(replies(["second"]));

  assert.equal(button.disabled, true);
  page.rerender(replies([]));

  assert.equal(button.disabled, false);
  assert.equal(clock.frames.size, 0);
});

test("history renders immediately and live text updates do not restart the reveal", () => {
  const clock = animationClock();
  const page = render(
    createElement(MarkdownMessage, { text: "旧的回复", streaming: false }),
  );

  assert.equal(page.container.textContent, "旧的回复");
  page.rerender(
    createElement(MarkdownMessage, { text: "更新后的回复", streaming: false }),
  );

  assert.equal(page.container.textContent, "更新后的回复");
  page.unmount();
  const live = render(
    createElement(MarkdownMessage, {
      text: "新的回复".repeat(50),
      streaming: true,
    }),
  );

  clock.advance(340);
  const prefix = live.container.textContent ?? "";

  live.rerender(
    createElement(MarkdownMessage, {
      text: "新的回复".repeat(80),
      streaming: true,
    }),
  );

  assert.equal(live.container.textContent, prefix);
  clock.advance(340);

  assert.ok(live.container.textContent?.startsWith(prefix));
  assert.ok((live.container.textContent?.length ?? 0) > prefix.length);
  live.unmount();

  assert.equal(clock.frames.size, 0);
});

test("a replaced source never displays stale text and stops the old reveal", () => {
  const clock = animationClock();
  const page = render(
    createElement(MarkdownMessage, {
      text: "旧内容".repeat(200),
      streaming: true,
    }),
  );

  clock.advance(340);
  page.rerender(
    createElement(MarkdownMessage, {
      text: "New final reply.",
      streaming: false,
    }),
  );

  assert.equal(page.container.textContent, "New final reply.");
  clock.advance(1000);

  assert.equal(page.container.textContent, "New final reply.");
  assert.equal(clock.frames.size, 0);
});

test("revealed prefixes keep emoji and combining characters intact", () => {
  const clock = animationClock();
  const graphemes = ["👩🏽‍💻", "e\u0301", "中", "🇨🇳"];
  const text = graphemes.join("").repeat(20);
  const boundaries = new Set<number>([0]);
  let boundary = 0;

  for (let repeat = 0; repeat < 20; repeat++) {
    for (const grapheme of graphemes) {
      boundary += grapheme.length;
      boundaries.add(boundary);
    }
  }

  const page = render(
    createElement(MarkdownMessage, { text, streaming: true }),
  );

  for (let frame = 0; frame < 100; frame++) {
    clock.advance(34);
    assert.ok(boundaries.has(page.container.textContent?.length ?? 0));
  }

  clock.advance(10_000);
  assert.equal(page.container.textContent, text);
  const tokens = [...page.container.querySelectorAll("[data-sd-animate]")].map(
    (node) => node.textContent,
  );

  for (const grapheme of graphemes) {
    assert.ok(tokens.includes(grapheme));
  }
});

test("long paced Markdown keeps finished blocks stable and avoids per-character DOM", () => {
  const clock = animationClock();
  const paragraph = "清晨的城市逐渐醒来，人们走向各自的生活。".repeat(20);
  const page = render(
    createElement(MarkdownMessage, { text: paragraph, streaming: true }),
  );

  clock.advance(10_000);
  const opening = page.container.querySelector("p");
  const text =
    Array.from({ length: 10 }, () => paragraph).join("\n\n") +
    "\n\n## Evening\n\nThe city is **quiet**.";

  page.rerender(createElement(MarkdownMessage, { text, streaming: true }));
  clock.advance(20_000);

  assert.ok(text.length > 3000);
  assert.equal(page.container.querySelector("p"), opening);
  assert.ok(page.container.querySelectorAll("*").length < 100);
  assert.equal(opening?.querySelectorAll("[data-sd-animate]").length, 0);
  assert.equal(page.getByRole("heading", { name: "Evening" }).tagName, "H2");
  assert.equal(
    page.container.querySelector('[data-streamdown="strong"]')?.textContent,
    "quiet",
  );
});

test("copy controls remain disabled until the display buffer finishes", () => {
  const clock = animationClock();
  const text =
    "| Season | Weather |\n| --- | --- |\n| Spring | Mild |\n\n" +
    "More details. ".repeat(80);
  const page = render(
    createElement(MarkdownMessage, { text, streaming: true }),
  );

  clock.advance(700);
  page.rerender(createElement(MarkdownMessage, { text, streaming: false }));

  assert.equal(page.getByTitle("Copy table").hasAttribute("disabled"), true);
  clock.advance(10_000);

  assert.equal(page.getByTitle("Copy table").hasAttribute("disabled"), false);
});

test("even a large final burst drains within three seconds after the model finishes", () => {
  const clock = animationClock();
  const text = "城市中的日常生活。".repeat(1000);
  const page = render(
    createElement(MarkdownMessage, { text, streaming: true }),
  );

  clock.advance(340);
  page.rerender(createElement(MarkdownMessage, { text, streaming: false }));
  clock.advance(3000);

  assert.equal(page.container.textContent?.length, text.length);
  assert.equal(clock.frames.size, 0);
});

test("reduced-motion preferences show live output immediately and release the scheduler", () => {
  const clock = animationClock();
  let matches = false;
  const media = new EventTarget();

  vi.stubGlobal("matchMedia", () => Object.assign(media, { matches }));
  const text = "Read this without delay. ".repeat(30).trim();
  const page = render(
    createElement(MarkdownMessage, { text, streaming: true }),
  );

  clock.advance(340);
  assert.ok((page.container.textContent?.length ?? 0) < text.length);
  act(() => {
    matches = true;
    media.dispatchEvent(new Event("change"));
  });

  assert.equal(page.container.textContent, text);
  assert.equal(clock.frames.size, 0);
  assert.equal(page.container.querySelectorAll("[data-sd-animate]").length, 0);
});

test("many source chunks in one frame do not bypass the display cadence", () => {
  const clock = animationClock();
  const page = render(
    createElement(MarkdownMessage, { text: "", streaming: true }),
  );

  for (let chunk = 1; chunk <= 100; chunk++) {
    page.rerender(
      createElement(MarkdownMessage, {
        text: "中".repeat(chunk * 10),
        streaming: true,
      }),
    );
  }

  assert.equal(page.container.textContent, "");
  clock.advance(34);
  const prefix = page.container.textContent ?? "";

  assert.ok(prefix.length > 0 && prefix.length < 30);
  page.unmount();
  assert.equal(clock.frames.size, 0);
});

test("new text keeps its fade while later display ticks arrive", () => {
  const clock = animationClock();
  const page = render(
    createElement(MarkdownMessage, {
      text: "清晨的城市正在醒来。".repeat(20),
      streaming: true,
    }),
  );

  clock.advance(68);
  const first = page.container.querySelector<HTMLElement>("[data-sd-animate]");

  assert.ok(first);
  assert.equal(first.style.getPropertyValue("--sd-duration"), "500ms");
  assert.equal(first.style.getPropertyValue("--sd-easing"), "ease-in-out");
  clock.advance(68);

  assert.equal(page.container.querySelector("[data-sd-animate]"), first);
  assert.equal(first.style.getPropertyValue("--sd-duration"), "500ms");
  assert.equal(first.style.getPropertyValue("--sd-delay"), "0ms");
});

test("a long unbroken paragraph keeps a fading tail without thousands of character elements", () => {
  const clock = animationClock();
  const text = "城市中的日常生活总会带来新的发现。".repeat(350);
  const page = render(
    createElement(MarkdownMessage, { text, streaming: true }),
  );

  clock.advance(9000);
  const visible = page.container.textContent ?? "";

  assert.ok(visible.length > 5000);
  assert.ok(page.container.querySelectorAll("[data-sd-animate]").length > 0);
  assert.ok(page.container.querySelectorAll("*").length < 400);
  assert.ok(text.startsWith(visible));
  page.rerender(createElement(MarkdownMessage, { text, streaming: false }));
  clock.advance(20_000);

  assert.equal(page.container.textContent, text);
  assert.equal(page.container.querySelectorAll("[data-sd-animate]").length, 0);
});

test("compacting old text does not restart the currently fading tail", () => {
  const clock = animationClock();
  const text = "城市中的日常生活总会带来新的发现。".repeat(350);
  const page = render(
    createElement(MarkdownMessage, { text, streaming: true }),
  );

  clock.advance(4000);
  const spans =
    page.container.querySelectorAll<HTMLElement>("[data-sd-animate]");
  const tail = spans[spans.length - 1];

  assert.ok(tail);
  clock.advance(340);

  assert.equal(tail.isConnected, true);
  assert.equal(tail.style.getPropertyValue("--sd-duration"), "500ms");
});
