// @vitest-environment jsdom
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { MemoryWorkspace } from "./MemoryWorkspace";

const preference = {
  id: "00000000-0000-4000-8000-000000000001",
  category: "preference",
  project: null,
  text: "Use concise replies.",
  sourceThreadId: "source conversation",
  sourceMessageId: "message-1",
  revision: 1,
  createdAt: "2026-10-10T00:00:00Z",
  updatedAt: "2026-10-10T00:00:00Z",
};
const projectFact = {
  ...preference,
  id: "00000000-0000-4000-8000-000000000002",
  category: "project",
  project: "Agent Playground",
  text: "Agent execution stays on the server.",
  sourceThreadId: null,
  sourceMessageId: null,
};

function renderWorkspace() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(MemoryWorkspace),
    ),
  );

  return { client, view };
}

test("loading resolves into inspectable preference and project memories with an encoded source link", async () => {
  let completeList: ((response: Response) => void) | undefined;

  vi.stubGlobal(
    "fetch",
    () =>
      new Promise<Response>((resolve) => {
        completeList = resolve;
      }),
  );
  const { client, view } = renderWorkspace();

  expect(view.getByRole("status")).toHaveTextContent("Loading memories");
  await waitFor(() => expect(completeList).toBeDefined());
  completeList?.(
    Response.json({ items: [preference, projectFact], nextOffset: null }),
  );
  await view.findByText("Use concise replies.");
  expect(view.getByText("Preference")).toBeInTheDocument();
  expect(view.getByText("Agent Playground")).toBeInTheDocument();
  expect(
    view.getByRole("link", { name: "Source conversation" }),
  ).toHaveAttribute("href", "/c/source%20conversation");
  expect(view.queryByRole("status")).toBeNull();
  view.unmount();
  client.clear();
});

test("a failed initial load can retry into an empty workspace without showing an empty state early", async () => {
  let attempts = 0;

  vi.stubGlobal("fetch", () => {
    attempts += 1;

    return Promise.resolve(
      attempts === 1
        ? Response.json({ error: "Service unavailable" }, { status: 503 })
        : Response.json({ items: [], nextOffset: null }),
    );
  });
  const { client, view } = renderWorkspace();
  const user = userEvent.setup();

  await view.findByRole("alert");
  expect(view.queryByText("No memories yet")).toBeNull();
  await user.click(view.getByRole("button", { name: "Try again" }));
  await view.findByText("No memories yet");
  expect(view.queryByRole("alert")).toBeNull();
  view.unmount();
  client.clear();
});

test("loading more uses the returned offset and retains existing memories after a page failure", async () => {
  const urls: string[] = [];
  let nextAttempts = 0;

  vi.stubGlobal("fetch", (url: string) => {
    urls.push(url);

    if (url.includes("offset=50")) {
      nextAttempts += 1;

      return Promise.resolve(
        nextAttempts === 1
          ? Response.json({ error: "Service unavailable" }, { status: 503 })
          : Response.json({ items: [projectFact], nextOffset: null }),
      );
    }

    return Promise.resolve(
      Response.json({ items: [preference], nextOffset: 50 }),
    );
  });
  const { client, view } = renderWorkspace();
  const user = userEvent.setup();

  await view.findByText(preference.text);
  await user.click(view.getByRole("button", { name: "Load more" }));
  await view.findByRole("alert");
  expect(view.getByText(preference.text)).toBeInTheDocument();
  await user.click(
    view.getByRole("button", { name: "Try loading more again" }),
  );
  await view.findByText(projectFact.text);
  expect(view.getByText(preference.text)).toBeInTheDocument();
  expect(urls).toEqual([
    "/api/memories?offset=0&limit=50",
    "/api/memories?offset=50&limit=50",
    "/api/memories?offset=50&limit=50",
  ]);
  expect(view.queryByRole("button", { name: "Load more" })).toBeNull();
  view.unmount();
  client.clear();
});

test("correction blocks pending dismissal and preserves entered text after a failed save", async () => {
  let completeEdit: ((response: Response) => void) | undefined;
  const edits: unknown[] = [];
  let stored = { ...preference };

  vi.stubGlobal("fetch", (_url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      edits.push(JSON.parse(init.body as string));

      if (edits.length === 1) {
        return new Promise<Response>((resolve) => {
          completeEdit = resolve;
        });
      }

      stored = {
        ...preference,
        text: "Prefer detailed explanations.",
        revision: 2,
      };

      return Promise.resolve(Response.json(stored));
    }

    return Promise.resolve(
      Response.json({ items: [stored], nextOffset: null }),
    );
  });
  const { client, view } = renderWorkspace();
  const user = userEvent.setup();
  const edit = await view.findByRole("button", {
    name: "Correct memory: Use concise replies.",
  });

  await user.click(edit);
  const dialog = view.getByRole("dialog", { name: "Correct memory" });
  const input = within(dialog).getByRole("textbox", { name: "Memory text" });

  await user.clear(input);
  await user.type(input, "Prefer detailed explanations.");
  await user.click(
    within(dialog).getByRole("button", { name: "Save correction" }),
  );
  expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
  await user.keyboard("{Escape}");
  fireEvent.pointerDown(
    document.querySelector('[data-slot="dialog-overlay"]')!,
  );
  expect(view.getByRole("dialog")).toBe(dialog);
  completeEdit?.(
    Response.json({ error: "Service unavailable" }, { status: 503 }),
  );
  await within(dialog).findByRole("alert");
  expect(input).toHaveValue("Prefer detailed explanations.");
  await user.click(
    within(dialog).getByRole("button", { name: "Save correction" }),
  );
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
  await view.findByText("Prefer detailed explanations.");
  expect(edits).toEqual([
    {
      category: "preference",
      project: null,
      revision: 1,
      text: "Prefer detailed explanations.",
    },
    {
      category: "preference",
      project: null,
      revision: 1,
      text: "Prefer detailed explanations.",
    },
  ]);
  expect(edit).toHaveFocus();
  view.unmount();
  client.clear();
});

test("a revision conflict retains the correction and requires review of the refreshed memory before saving", async () => {
  let stored = { ...preference };
  const edits: unknown[] = [];

  vi.stubGlobal("fetch", (_url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      edits.push(JSON.parse(init.body as string));

      if (edits.length === 1) {
        stored = {
          ...preference,
          text: "Use examples in replies.",
          revision: 2,
        };

        return Promise.resolve(
          Response.json(
            { error: "Memory changed. Review the latest version." },
            { status: 409 },
          ),
        );
      }

      stored = {
        ...stored,
        text: "Prefer detailed explanations.",
        revision: 3,
      };

      return Promise.resolve(Response.json(stored));
    }

    return Promise.resolve(
      Response.json({ items: [stored], nextOffset: null }),
    );
  });
  const { client, view } = renderWorkspace();
  const user = userEvent.setup();

  await user.click(
    await view.findByRole("button", {
      name: "Correct memory: Use concise replies.",
    }),
  );
  const dialog = view.getByRole("dialog", { name: "Correct memory" });
  const input = within(dialog).getByRole("textbox", { name: "Memory text" });

  await user.clear(input);
  await user.type(input, "Prefer detailed explanations.");
  await user.click(
    within(dialog).getByRole("button", { name: "Save correction" }),
  );
  await within(dialog).findByText("Use examples in replies.");
  expect(input).toHaveValue("Prefer detailed explanations.");
  expect(
    within(dialog).getByRole("button", { name: "Save correction" }),
  ).toBeDisabled();
  await user.click(
    within(dialog).getByRole("button", { name: "Keep my correction" }),
  );
  await user.click(
    within(dialog).getByRole("button", { name: "Save correction" }),
  );
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
  expect(edits).toEqual([
    {
      category: "preference",
      project: null,
      revision: 1,
      text: "Prefer detailed explanations.",
    },
    {
      category: "preference",
      project: null,
      revision: 2,
      text: "Prefer detailed explanations.",
    },
  ]);
  view.unmount();
  client.clear();
});

test("forgetting names the selected memory, confirms intent, and keeps a failed request available for retry", async () => {
  let completeForget: ((response: Response) => void) | undefined;
  let removed = false;
  const requests: unknown[] = [];

  vi.stubGlobal("fetch", (_url: string, init?: RequestInit) => {
    if (init?.method === "DELETE") {
      requests.push(JSON.parse(init.body as string));

      if (requests.length === 1) {
        return new Promise<Response>((resolve) => {
          completeForget = resolve;
        });
      }

      removed = true;

      return Promise.resolve(new Response(null, { status: 204 }));
    }

    return Promise.resolve(
      Response.json({ items: removed ? [] : [preference], nextOffset: null }),
    );
  });
  const { client, view } = renderWorkspace();
  const user = userEvent.setup();
  const forget = await view.findByRole("button", {
    name: "Forget memory: Use concise replies.",
  });

  await user.click(forget);
  let dialog = view.getByRole("alertdialog", { name: "Forget memory?" });

  expect(dialog).toHaveTextContent(preference.text);
  expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(requests).toEqual([]);
  expect(forget).toHaveFocus();
  await user.click(forget);
  dialog = view.getByRole("alertdialog", { name: "Forget memory?" });
  await user.click(
    within(dialog).getByRole("button", { name: "Forget memory" }),
  );
  expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
  await user.keyboard("{Escape}");
  expect(view.getByRole("alertdialog")).toBe(dialog);
  completeForget?.(
    Response.json({ error: "Service unavailable" }, { status: 503 }),
  );
  await within(dialog).findByRole("alert");
  await user.click(
    within(dialog).getByRole("button", { name: "Forget memory" }),
  );
  await waitFor(() => expect(view.queryByRole("alertdialog")).toBeNull());
  await view.findByText("No memories yet");
  expect(requests).toEqual([
    { category: "preference", project: null, revision: 1 },
    { category: "preference", project: null, revision: 1 },
  ]);
  expect(view.getByRole("link", { name: "Back to chat" })).toHaveFocus();
  view.unmount();
  client.clear();
});

test("a conflict with a failed refresh cannot acknowledge the stale version as latest", async () => {
  let listRequests = 0;

  vi.stubGlobal("fetch", (_url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      return Promise.resolve(
        Response.json(
          { error: "Memory changed. Review the latest version." },
          { status: 409 },
        ),
      );
    }

    listRequests += 1;

    if (listRequests === 2) {
      return Promise.resolve(
        Response.json({ error: "Service unavailable" }, { status: 503 }),
      );
    }

    const record =
      listRequests === 1
        ? preference
        : { ...preference, text: "Use examples in replies.", revision: 2 };

    return Promise.resolve(
      Response.json({ items: [record], nextOffset: null }),
    );
  });
  const { client, view } = renderWorkspace();
  const user = userEvent.setup();

  await user.click(
    await view.findByRole("button", {
      name: "Correct memory: Use concise replies.",
    }),
  );
  const dialog = view.getByRole("dialog", { name: "Correct memory" });
  const input = within(dialog).getByRole("textbox", { name: "Memory text" });

  await user.clear(input);
  await user.type(input, "Prefer detailed explanations.");
  await user.click(
    within(dialog).getByRole("button", { name: "Save correction" }),
  );
  await within(dialog).findByRole("alert");
  expect(
    within(dialog).queryByRole("button", { name: "Keep my correction" }),
  ).toBeNull();
  expect(
    within(dialog).getByRole("button", { name: "Save correction" }),
  ).toBeDisabled();
  await user.click(
    within(dialog).getByRole("button", { name: "Refresh latest memory" }),
  );
  await within(dialog).findByText("Use examples in replies.");
  expect(input).toHaveValue("Prefer detailed explanations.");
  expect(
    within(dialog).getByRole("button", { name: "Keep my correction" }),
  ).toBeEnabled();
  view.unmount();
  client.clear();
});

test("forget conflict recovery refreshes inside the confirmation and requires review before deleting a newer version", async () => {
  let listRequests = 0;
  let removed = false;
  let completeRefresh: ((response: Response) => void) | undefined;
  const requests: unknown[] = [];
  const updated = {
    ...preference,
    text: "Use examples in replies.",
    revision: 2,
  };

  vi.stubGlobal("fetch", (_url: string, init?: RequestInit) => {
    if (init?.method === "DELETE") {
      requests.push(JSON.parse(init.body as string));

      if (requests.length === 1) {
        return Promise.resolve(
          Response.json(
            { error: "Memory changed. Review the latest version." },
            { status: 409 },
          ),
        );
      }

      removed = true;

      return Promise.resolve(new Response(null, { status: 204 }));
    }

    listRequests += 1;

    if (listRequests === 2) {
      return Promise.resolve(
        Response.json({ error: "Service unavailable" }, { status: 503 }),
      );
    }

    if (listRequests === 3) {
      return new Promise<Response>((resolve) => {
        completeRefresh = resolve;
      });
    }

    return Promise.resolve(
      Response.json({ items: removed ? [] : [preference], nextOffset: null }),
    );
  });
  const { client, view } = renderWorkspace();
  const user = userEvent.setup();

  await user.click(
    await view.findByRole("button", {
      name: "Forget memory: Use concise replies.",
    }),
  );
  const dialog = view.getByRole("alertdialog", { name: "Forget memory?" });

  await user.click(
    within(dialog).getByRole("button", { name: "Forget memory" }),
  );
  await within(dialog).findByRole("alert");
  expect(
    within(dialog).getByRole("button", { name: "Forget memory" }),
  ).toBeDisabled();
  expect(
    within(dialog).queryByRole("button", { name: "Review latest memory" }),
  ).toBeNull();
  const refresh = within(dialog).getByRole("button", {
    name: "Refresh latest memory",
  });

  await user.click(refresh);
  expect(refresh).toBeDisabled();
  expect(dialog).toHaveTextContent(preference.text);
  expect(requests).toEqual([
    { category: "preference", project: null, revision: 1 },
  ]);
  completeRefresh?.(Response.json({ items: [updated], nextOffset: null }));
  await within(dialog).findByText(updated.text);
  expect(view.getByRole("alertdialog")).toBe(dialog);
  expect(dialog).toHaveTextContent(preference.text);
  expect(
    within(dialog).getByRole("button", { name: "Forget memory" }),
  ).toBeDisabled();
  await user.click(
    within(dialog).getByRole("button", { name: "Review latest memory" }),
  );
  expect(within(dialog).queryByText(preference.text)).toBeNull();
  await user.click(
    within(dialog).getByRole("button", { name: "Forget memory" }),
  );
  await waitFor(() => expect(view.queryByRole("alertdialog")).toBeNull());
  expect(requests).toEqual([
    { category: "preference", project: null, revision: 1 },
    { category: "preference", project: null, revision: 2 },
  ]);
  view.unmount();
  client.clear();
});

test("invalid saved memory data is reported as an error instead of rendering unbounded text", async () => {
  vi.stubGlobal("fetch", () =>
    Promise.resolve(
      Response.json({
        items: [{ ...preference, text: "x".repeat(1001) }],
        nextOffset: null,
      }),
    ),
  );
  const { client, view } = renderWorkspace();

  await view.findByRole("alert");
  expect(view.queryByText("x".repeat(1001))).toBeNull();
  view.unmount();
  client.clear();
});

test("unmount aborts an owned correction and does not refresh a departed workspace", async () => {
  let editSignal: AbortSignal | undefined;
  let listRequests = 0;

  vi.stubGlobal("fetch", (_url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      editSignal = init.signal!;

      return new Promise<Response>((_resolve, reject) => {
        editSignal!.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      });
    }

    listRequests += 1;

    return Promise.resolve(
      Response.json({ items: [preference], nextOffset: null }),
    );
  });
  const { client, view } = renderWorkspace();
  const user = userEvent.setup();

  await user.click(
    await view.findByRole("button", {
      name: "Correct memory: Use concise replies.",
    }),
  );
  const dialog = view.getByRole("dialog", { name: "Correct memory" });

  await user.type(
    within(dialog).getByRole("textbox", { name: "Memory text" }),
    " Use examples.",
  );
  await user.click(
    within(dialog).getByRole("button", { name: "Save correction" }),
  );
  await waitFor(() => expect(editSignal).toBeDefined());
  view.unmount();
  expect(editSignal!.aborted).toBe(true);
  await Promise.resolve();
  expect(listRequests).toBe(1);
  client.clear();
});
