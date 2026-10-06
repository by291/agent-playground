// @vitest-environment jsdom
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { MotionGlobalConfig } from "motion/react";
import { KnowledgeWorkspace } from "./KnowledgeWorkspace";

const documentFixture = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "policy.md",
  size: 1024,
  status: "ready",
  error: null,
  textEncoding: null,
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

afterEach(() => {
  MotionGlobalConfig.skipAnimations = true;
});

test("an explicit text encoding is retained for retry after a failed reindex request", async () => {
  const encodings: (string | null)[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        encodings.push(new Headers(init.headers).get("X-Text-Encoding"));

        return Promise.resolve(
          encodings.length === 1
            ? Response.json({ error: "Storage offline" }, { status: 503 })
            : Response.json({ ...documentFixture, textEncoding: "gbk" }),
        );
      }

      return Promise.resolve(Response.json([documentFixture]));
    }),
  );
  const { client, view } = renderWorkspace();
  const user = userEvent.setup();

  const actions = await view.findByRole("button", {
    name: "Actions for policy.md",
  });

  await user.click(actions);
  await user.click(view.getByRole("menuitem", { name: "Text encoding" }));
  const dialog = view.getByRole("dialog", { name: "Text encoding" });

  within(dialog).getByRole("combobox", { name: "Text encoding" }).focus();
  await user.keyboard("gbk");
  expect(encodings).toEqual([]);
  await user.click(
    within(dialog).getByRole("button", { name: "Reindex document" }),
  );
  await within(dialog).findByText("Storage offline");
  expect(view.getByRole("dialog", { name: "Text encoding" })).toBe(dialog);
  expect(within(dialog).getByRole("combobox")).toHaveTextContent("GBK");
  await user.click(
    within(dialog).getByRole("button", { name: "Reindex document" }),
  );
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(actions).toHaveFocus());
  expect(encodings).toEqual(["gbk", "gbk"]);
  view.unmount();
  client.clear();
});

test("document deletion requires confirmation, blocks pending dismissal and preserves a failed request for retry", async () => {
  MotionGlobalConfig.skipAnimations = false;
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
  const user = userEvent.setup();
  const deleteTrigger = await view.findByRole("button", {
    name: "Actions for policy.md",
  });

  await user.click(deleteTrigger);
  await user.click(view.getByRole("menuitem", { name: "Delete" }));
  let dialog = view.getByRole("alertdialog", { name: "Delete document?" });

  expect(dialog).toHaveTextContent("shared knowledge base");
  expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(deleteRequests).toBe(0);
  expect(view.queryByRole("alertdialog")).toBeNull();
  expect(deleteTrigger).toHaveFocus();
  await user.click(deleteTrigger);
  await user.click(view.getByRole("menuitem", { name: "Delete" }));
  dialog = view.getByRole("alertdialog", { name: "Delete document?" });
  await user.click(
    within(dialog).getByRole("button", {
      name: "Delete document",
    }),
  );
  expect(deleteRequests).toBe(1);
  expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
  await user.keyboard("{Escape}");
  expect(view.getByRole("alertdialog")).toBe(dialog);
  completeDelete?.(
    Response.json({ error: "Storage offline" }, { status: 503 }),
  );
  await within(dialog).findByRole("alert");
  expect(view.getByRole("alertdialog")).toBe(dialog);
  expect(view.getAllByText("Storage offline")).toHaveLength(1);
  await user.click(
    within(dialog).getByRole("button", {
      name: "Delete document",
    }),
  );
  await waitFor(() => expect(view.queryByRole("alertdialog")).toBeNull());
  expect(deleteRequests).toBe(2);
  await waitFor(() => expect(view.queryByText("policy.md")).toBeNull());
  expect(view.getByRole("button", { name: "Upload document" })).toHaveFocus();
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
  const user = userEvent.setup();
  const actions = await view.findByRole("button", {
    name: "Actions for policy.md",
  });

  await user.click(actions);
  await user.click(view.getByRole("menuitem", { name: "Reindex" }));
  expect(view.getByRole("status")).toHaveTextContent("Queuing index…");
  expect(view.getByRole("button", { name: "Upload document" })).toBeDisabled();
  expect(view.queryByText("Uploading…")).toBeNull();
  completeIndex?.(Response.json({}));
  await waitFor(() => expect(actions).toBeEnabled());
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

  await view.findByText("Upload a file to build your shared knowledge base.");
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
