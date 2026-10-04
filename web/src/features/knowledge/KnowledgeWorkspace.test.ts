// @vitest-environment jsdom
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { KnowledgeWorkspace } from "./KnowledgeWorkspace";

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
