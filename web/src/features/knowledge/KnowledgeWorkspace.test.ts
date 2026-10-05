// @vitest-environment jsdom
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { KnowledgeWorkspace } from "./KnowledgeWorkspace";

const documentFixture = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "policy.md",
  size: 1024,
  status: "ready",
  error: null,
  chunkCount: 2,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function renderWorkspace() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(KnowledgeWorkspace),
    ),
  );

  return { client, view };
}

function mockDialog() {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.setAttribute("open", "");
      },
    },
    close: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.removeAttribute("open");
        this.dispatchEvent(new Event("close"));
      },
    },
  });
}

afterEach(() => {
  Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});

test("document deletion requires confirmation, blocks pending dismissal and preserves a failed request for retry", async () => {
  mockDialog();
  let completeDelete: ((response: Response) => void) | undefined;
  let removed = false;
  let deleteRequests = 0;

  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        deleteRequests += 1;

        if (deleteRequests === 1) {
          return new Promise<Response>((resolve) => {
            completeDelete = resolve;
          });
        }

        removed = true;

        return Promise.resolve(Response.json({}));
      }

      return Promise.resolve(Response.json(removed ? [] : [documentFixture]));
    }),
  );
  const { client, view } = renderWorkspace();
  const deleteTrigger = await view.findByRole("button", {
    name: "Delete policy.md",
  });

  fireEvent.click(deleteTrigger);
  const dialog = view.getByRole("dialog", { name: "Delete document?" });

  expect(dialog).toHaveTextContent("shared knowledge base");
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(deleteRequests).toBe(0);
  expect(dialog).not.toHaveAttribute("open");
  fireEvent.click(deleteTrigger);
  fireEvent.click(
    within(dialog).getByRole("button", {
      name: "Delete document",
    }),
  );
  expect(deleteRequests).toBe(1);
  expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
  const cancel = new Event("cancel", { cancelable: true });

  fireEvent(dialog, cancel);
  expect(cancel.defaultPrevented).toBe(true);
  completeDelete?.(
    Response.json({ error: "Storage offline" }, { status: 503 }),
  );
  await within(dialog).findByRole("alert");
  expect(dialog).toHaveAttribute("open");
  expect(view.getAllByText("Storage offline")).toHaveLength(1);
  fireEvent.click(
    within(dialog).getByRole("button", {
      name: "Delete document",
    }),
  );
  await waitFor(() => expect(dialog).not.toHaveAttribute("open"));
  expect(deleteRequests).toBe(2);
  await waitFor(() => expect(view.queryByText("policy.md")).toBeNull());
  view.unmount();
  client.clear();
});

test("reindex feedback belongs to its document while the upload action keeps its label", async () => {
  let completeIndex: ((response: Response) => void) | undefined;

  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return new Promise<Response>((resolve) => {
          completeIndex = resolve;
        });
      }

      return Promise.resolve(Response.json([documentFixture]));
    }),
  );
  const { client, view } = renderWorkspace();

  fireEvent.click(await view.findByRole("button", { name: "Reindex" }));
  expect(view.getByRole("status")).toHaveTextContent("Queuing index…");
  expect(view.getByRole("button", { name: "Upload document" })).toBeDisabled();
  expect(view.queryByText("Uploading…")).toBeNull();
  completeIndex?.(Response.json({}));
  await waitFor(() =>
    expect(view.getByRole("button", { name: "Reindex" })).toBeEnabled(),
  );
  view.unmount();
  client.clear();
});

test("failed uploads keep their file and stable identity for a retry", async () => {
  const uploadedIds: string[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        uploadedIds.push(
          (init.headers as Record<string, string>)["X-Document-Id"]!,
        );

        if (uploadedIds.length === 1) {
          return Promise.resolve(
            Response.json({ error: "Storage offline" }, { status: 503 }),
          );
        }

        return Promise.resolve(Response.json({}));
      }

      return Promise.resolve(Response.json([]));
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(KnowledgeWorkspace),
    ),
  );

  await view.findByText(
    "No documents yet. Upload a file to build your shared knowledge base.",
  );
  fireEvent.change(view.getByLabelText("Document file"), {
    target: { files: [new File(["returns"], "policy.md")] },
  });
  await view.findByText("Storage offline");
  fireEvent.click(view.getByRole("button", { name: "Retry upload" }));
  await waitFor(() => expect(uploadedIds).toHaveLength(2));
  expect(uploadedIds[0]).toBe(uploadedIds[1]);
  await waitFor(() =>
    expect(
      view.queryByRole("button", { name: "Retry upload" }),
    ).not.toBeInTheDocument(),
  );
  view.unmount();
  client.clear();
});
