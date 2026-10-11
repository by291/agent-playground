// @vitest-environment jsdom
import assert from "node:assert/strict";
import { createElement, useState, type ReactNode } from "react";
import { expect, onTestFinished, test, vi } from "vitest";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConversationProvider } from "../../providers/ConversationProvider";
import { MessageComposer } from "./MessageComposer";
import {
  newConversation,
  type ConversationReference,
} from "../../model/conversation-storage";

const threadId = "attachment-test-thread";

function acceptedResponse(init: RequestInit | undefined) {
  const input = JSON.parse(init?.body as string) as {
    threadId: string;
    runId: string;
  };
  const events = ["RUN_STARTED", "RUN_FINISHED"]
    .map(
      (type) =>
        `data: ${JSON.stringify({ type, ...input, messages: undefined, state: undefined, tools: undefined, context: undefined })}\n\n`,
    )
    .join("");

  return new Response(events, {
    headers: { "Content-Type": "text/event-stream" },
  });
}

function Draft() {
  const [prompt, setPrompt] = useState("");

  return createElement(MessageComposer, {
    prompt,
    onPromptChange: setPrompt,
  });
}

function page(
  conversation: ConversationReference = { threadId, empty: true, fresh: true },
  onThreadCreated?: (threadId: string) => void,
  draft: ReactNode = createElement(Draft),
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
        children: draft,
      }),
    ),
  );
}

test("the composer owns local image URLs and releases them on removal or unmount", () => {
  const create = vi
    .spyOn(URL, "createObjectURL")
    .mockReturnValueOnce("blob:first")
    .mockReturnValueOnce("blob:second");
  const revoke = vi.spyOn(URL, "revokeObjectURL");

  vi.stubGlobal("fetch", () =>
    Promise.resolve(Response.json({ model: "test-model" })),
  );
  const view = page();

  fireEvent.change(view.getByLabelText("Choose files"), {
    target: {
      files: [new File(["one"], "first.png"), new File(["two"], "second.png")],
    },
  });
  expect(create).toHaveBeenCalledTimes(2);
  expect(view.getByRole("img", { name: "first.png" })).toHaveAttribute(
    "src",
    "blob:first",
  );
  fireEvent.click(view.getByRole("button", { name: "Remove first.png" }));
  expect(revoke).toHaveBeenCalledWith("blob:first");
  view.unmount();
  expect(revoke).toHaveBeenCalledWith("blob:second");
});

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

      return Promise.resolve(acceptedResponse(init));
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

      return Promise.resolve(acceptedResponse(init));
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

test("a failed submission journal retains the prompt and uploaded attachment for retry", async () => {
  const requests: string[] = [];

  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    requests.push(url);

    if (url === "/agent-info") {
      return Promise.resolve(Response.json({ model: "test-model" }));
    }

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
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Quota exceeded", "QuotaExceededError");
  });
  const view = page();

  fireEvent.change(view.getByLabelText("Choose files"), {
    target: { files: [new File(["amount\n20"], "orders.csv")] },
  });
  fireEvent.change(view.getByRole("textbox", { name: "Message" }), {
    target: { value: "Keep this draft" },
  });
  fireEvent.click(view.getByRole("button", { name: "Send message" }));
  await waitFor(() =>
    expect(view.getByRole("alert")).toHaveTextContent(
      "Cannot save this submission",
    ),
  );
  expect(view.getByRole("textbox", { name: "Message" })).toHaveValue(
    "Keep this draft",
  );
  expect(view.getByText("orders.csv")).toBeInTheDocument();
  expect(requests).not.toContain("/agent");
});

test("a rejected admission retains the draft and displays the failure", async () => {
  vi.stubGlobal("fetch", (url: string) =>
    Promise.resolve(
      url === "/agent-info"
        ? Response.json({ model: "test-model" })
        : Response.json({ error: "Admission rejected" }, { status: 400 }),
    ),
  );
  const view = page();

  fireEvent.change(view.getByRole("textbox", { name: "Message" }), {
    target: { value: "Keep rejected input" },
  });
  fireEvent.click(view.getByRole("button", { name: "Send message" }));
  await waitFor(() =>
    expect(view.getByRole("alert")).toHaveTextContent(/400|Admission rejected/),
  );
  expect(view.getByRole("textbox", { name: "Message" })).toHaveValue(
    "Keep rejected input",
  );
});

test.each([false, true])(
  "confirmed admission clears only the submitted draft while streaming (new draft: %s)",
  async (replaceDraft) => {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    let input: { threadId: string; runId: string } | undefined;

    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      if (url === "/agent-info") {
        return Promise.resolve(Response.json({ model: "test-model" }));
      }

      if (url === "/agent") {
        input = JSON.parse(init!.body as string) as typeof input;

        return Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                stream = controller;
              },
            }),
            {
              headers: { "Content-Type": "text/event-stream" },
            },
          ),
        );
      }

      return Promise.resolve(new Response(null, { status: 404 }));
    });

    function ExternalDraft() {
      const [prompt, setPrompt] = useState("");

      return createElement(
        "div",
        null,
        createElement(
          "button",
          { onClick: () => setPrompt("A newer draft") },
          "Replace draft",
        ),
        createElement(MessageComposer, { prompt, onPromptChange: setPrompt }),
      );
    }

    const view = page(undefined, undefined, createElement(ExternalDraft));

    fireEvent.change(view.getByRole("textbox", { name: "Message" }), {
      target: { value: "Wait for admission" },
    });
    fireEvent.click(view.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(input).toBeDefined());
    expect(view.getByRole("textbox", { name: "Message" })).toHaveValue(
      "Wait for admission",
    );

    if (replaceDraft) {
      fireEvent.click(view.getByRole("button", { name: "Replace draft" }));
    }

    await act(async () => {
      stream.enqueue(
        new TextEncoder().encode(
          `data: ${JSON.stringify({ type: "RUN_STARTED", ...input })}\n\n`,
        ),
      );
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(view.getByRole("textbox", { name: "Message" })).toHaveValue(
        replaceDraft ? "A newer draft" : "",
      ),
    );
    expect(
      view.getByRole("button", { name: "Agent is responding" }),
    ).toBeDisabled();
    await act(async () => {
      stream.enqueue(
        new TextEncoder().encode(
          `data: ${JSON.stringify({ type: "RUN_FINISHED", ...input })}\n\n`,
        ),
      );
      stream.close();
      await Promise.resolve();
    });
  },
);

test("attachment references count toward the workflow feedback limit and leave the draft intact", async () => {
  const requests: string[] = [];
  const feedback = "x".repeat(9980);

  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    requests.push(url);

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

    return Promise.resolve(
      Response.json({
        messages: [],
        outputs: [],
        runs: [{ runId: "initial", status: "interrupted" }],
        interrupts: [
          {
            id: "review",
            reason: "Review output",
            metadata: {
              langgraph: {
                raw: {
                  kind: "workflow_review",
                  workflowCallId: "call",
                  revision: 1,
                  round: 1,
                  outputStepId: "output",
                  canAccept: true,
                },
              },
            },
          },
        ],
      }),
    );
  });
  const view = page({ threadId });

  await waitFor(() =>
    expect(view.getByRole("textbox", { name: "Message" })).toBeEnabled(),
  );
  fireEvent.change(view.getByLabelText("Choose files"), {
    target: { files: [new File(["amount\n20"], "orders.csv")] },
  });
  fireEvent.change(view.getByRole("textbox", { name: "Message" }), {
    target: { value: feedback },
  });
  fireEvent.click(view.getByRole("button", { name: "Send message" }));
  await waitFor(() =>
    expect(view.getByRole("alert")).toHaveTextContent(
      /10,000 characters, including attachment references/,
    ),
  );
  expect(view.getByRole("textbox", { name: "Message" })).toHaveValue(feedback);
  expect(view.getByText("orders.csv")).toBeInTheDocument();
  expect(requests).not.toContain("/agent");
});

test.each(["running", "completed", "submission_unknown"] as const)(
  "lost admission response keeps the draft until recovery confirms admission (%s)",
  async (status) => {
    let input:
      | {
          threadId: string;
          runId: string;
          messages: { id: string; role: string; content: string }[];
        }
      | undefined;
    let resolveSnapshot: ((response: Response) => void) | undefined;
    let submissions = 0;

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
        submissions += 1;
        input = JSON.parse(init!.body as string) as typeof input;

        return Promise.reject(new TypeError("Admission response was lost"));
      }

      return new Promise<Response>((resolve) => {
        resolveSnapshot = resolve;
      });
    });
    const view = page();

    fireEvent.change(view.getByLabelText("Choose files"), {
      target: { files: [new File(["amount\n20"], "orders.csv")] },
    });
    fireEvent.change(view.getByRole("textbox", { name: "Message" }), {
      target: { value: "Keep until confirmed" },
    });
    fireEvent.click(view.getByRole("button", { name: "Send message" }));
    await waitFor(() =>
      expect(view.getByRole("alert")).toHaveTextContent(/response was lost/),
    );
    expect(view.getByRole("textbox", { name: "Message" })).toHaveValue(
      "Keep until confirmed",
    );
    await waitFor(() => expect(resolveSnapshot).toBeDefined());
    await act(async () => {
      resolveSnapshot!(
        Response.json({
          messages: input!.messages,
          outputs: [],
          interrupts: [],
          runs: [{ runId: input!.runId, status }],
        }),
      );
      await Promise.resolve();
    });

    if (status === "submission_unknown") {
      expect(view.getByRole("textbox", { name: "Message" })).toHaveValue(
        "Keep until confirmed",
      );
      expect(view.getByText("orders.csv")).toBeInTheDocument();
    } else {
      await waitFor(() =>
        expect(view.getByRole("textbox", { name: "Message" })).toHaveValue(""),
      );
      await waitFor(() =>
        expect(view.queryByText("orders.csv")).not.toBeInTheDocument(),
      );
      expect(view.queryByRole("alert")).not.toBeInTheDocument();
    }

    expect(submissions).toBe(1);
  },
);
