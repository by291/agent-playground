// @vitest-environment jsdom
import assert from "node:assert/strict";
import { createElement, useState } from "react";
import { expect, onTestFinished, test, vi } from "vitest";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConversationProvider } from "../ConversationProvider";
import { Composer } from "./Composer";
import { newConversation, type ConversationReference } from "../model/storage";

const threadId = "attachment-test-thread";

function Draft() {
  const [prompt, setPrompt] = useState("");

  return createElement(Composer, {
    prompt,
    onPromptChange: setPrompt,
  });
}

function page(
  conversation: ConversationReference = { threadId, empty: true, fresh: true },
  onThreadCreated?: (threadId: string) => void,
) {
  const client = new QueryClient();

  onTestFinished(() => client.clear());

  return render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(ConversationProvider, {
        conversation,
        ...(onThreadCreated ? { onThreadCreated } : {}),
        children: createElement(Draft),
      }),
    ),
  );
}

test("a draft allocates its thread only on send and retries uploads with the same identity", async () => {
  const threads: string[] = [];
  const uploads: { url: string; fileId: string | null }[] = [];
  let submitted:
    { threadId: string; messages: { content: string }[] } | undefined;

  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    if (url === "/agent-info") {
      return Promise.resolve(Response.json({ model: "test-model" }));
    }

    if (url.endsWith("/files")) {
      const fileId = new Headers(init?.headers).get("X-File-Id");

      uploads.push({ url, fileId });

      if (uploads.length === 1) {
        return Promise.resolve(
          Response.json({ error: "Storage unavailable" }, { status: 503 }),
        );
      }

      return Promise.resolve(
        Response.json(
          { id: fileId, threadId: threads[0], name: "orders.csv", size: 9 },
          { status: 201 },
        ),
      );
    }

    if (url === "/agent") {
      submitted = JSON.parse(init?.body as string) as typeof submitted;

      return Promise.resolve(
        new Response("", { headers: { "Content-Type": "text/event-stream" } }),
      );
    }

    return Promise.resolve(new Response(null, { status: 404 }));
  });
  const view = page(newConversation(), (id) => threads.push(id));
  const user = userEvent.setup();

  fireEvent.change(view.getByLabelText("Choose files"), {
    target: { files: [new File(["amount\n20"], "orders.csv")] },
  });
  await user.type(view.getByRole("textbox", { name: "Message" }), "Summarize");
  expect(threads).toEqual([]);
  expect(uploads).toEqual([]);
  expect(localStorage.getItem("agent-playground-conversation")).toBeNull();
  await user.click(view.getByRole("button", { name: "Send message" }));
  await waitFor(() =>
    expect(view.getByRole("alert")).toHaveTextContent("Storage unavailable"),
  );
  expect(threads).toHaveLength(1);
  expect(submitted).toBeUndefined();
  await user.click(view.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(submitted).toBeDefined());
  expect(threads).toHaveLength(1);
  expect(uploads[0]).toEqual(uploads[1]);
  expect(uploads[0]!.url).toBe(`/conversations/${threads[0]}/files`);
  expect(submitted!.threadId).toBe(threads[0]);
  expect(submitted!.messages.at(-1)!.content).toContain(
    `File ID: ${uploads[0]!.fileId}`,
  );
});

test("failed attachment upload retains the draft and selected file for retry", async () => {
  const requests: string[] = [];

  vi.stubGlobal("fetch", (url: string) => {
    requests.push(url);

    if (url === "/agent-info") {
      return Promise.resolve(Response.json({ model: "test-model" }));
    }

    return Promise.resolve(
      Response.json({ error: "File storage is unavailable" }, { status: 503 }),
    );
  });
  const view = page();
  const user = userEvent.setup();

  fireEvent.change(view.getByLabelText("Choose files"), {
    target: { files: [new File(["amount\n20"], "orders.csv")] },
  });
  await user.type(
    view.getByRole("textbox", { name: "Message" }),
    "Summarize this CSV",
  );
  await user.click(view.getByRole("button", { name: "Send message" }));
  await waitFor(() =>
    assert.match(
      view.getByRole("alert").textContent ?? "",
      /File storage is unavailable/,
    ),
  );
  assert.equal(
    (view.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement)
      .value,
    "Summarize this CSV",
  );
  assert.ok(view.getByText("orders.csv"));
  assert.equal(requests.includes("/agent"), false);
});

test("successful attachment upload includes its file ID in the submitted user message", async () => {
  let submitted: { messages: { content: string }[] } | undefined;

  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    if (url === "/agent-info") {
      return Promise.resolve(Response.json({ model: "test-model" }));
    }

    if (url.endsWith("/files")) {
      return Promise.resolve(
        Response.json(
          {
            id: new Headers(init?.headers).get("X-File-Id"),
            threadId,
            name: "orders.csv",
            size: 9,
          },
          { status: 201 },
        ),
      );
    }

    if (url === "/agent") {
      submitted = JSON.parse(init?.body as string) as typeof submitted;

      return Promise.resolve(
        new Response("", { headers: { "Content-Type": "text/event-stream" } }),
      );
    }

    return Promise.resolve(new Response(null, { status: 404 }));
  });
  const view = page();
  const user = userEvent.setup();

  fireEvent.change(view.getByLabelText("Choose files"), {
    target: { files: [new File(["amount\n20"], "orders.csv")] },
  });
  await user.type(view.getByRole("textbox", { name: "Message" }), "Summarize");
  await user.click(view.getByRole("button", { name: "Send message" }));
  await waitFor(() => assert.ok(submitted));
  assert.match(
    submitted!.messages.at(-1)!.content,
    /Uploaded files.*orders.csv.*File ID:/s,
  );
  assert.equal(
    (view.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement)
      .value,
    "",
  );
});

test("a failed upload keeps sibling uploads owned until unmount aborts them", async () => {
  const signals: AbortSignal[] = [];
  let failUpload: ((response: Response) => void) | undefined;

  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    if (url === "/agent-info") {
      return Promise.resolve(Response.json({ model: "test-model" }));
    }

    signals.push(init!.signal!);

    if (signals.length === 1) {
      return new Promise<Response>((resolve) => {
        failUpload = resolve;
      });
    }

    return new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => {
        reject(new DOMException("Upload aborted", "AbortError"));
      });
    });
  });
  const view = page();
  const user = userEvent.setup();

  fireEvent.change(view.getByLabelText("Choose files"), {
    target: {
      files: [new File(["a"], "first.csv"), new File(["b"], "second.csv")],
    },
  });
  await user.type(view.getByRole("textbox", { name: "Message" }), "Summarize");
  await user.click(view.getByRole("button", { name: "Send message" }));
  await waitFor(() => assert.equal(signals.length, 2));
  await act(async () => {
    failUpload!(
      Response.json({ error: "Storage unavailable" }, { status: 503 }),
    );
    await Promise.resolve();
  });
  assert.equal(
    (view.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement)
      .disabled,
    true,
  );
  view.unmount();
  assert.equal(signals[1]!.aborted, true);
});
