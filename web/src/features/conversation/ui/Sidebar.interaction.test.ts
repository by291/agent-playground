// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
import { createElement } from "react";
import { fireEvent, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Sidebar } from "./Sidebar";
import type { ConversationHistory } from "../model/useConversationHistory";

function renderSidebar() {
  const client = new QueryClient();
  const history: ConversationHistory = {
    conversations: [
      {
        threadId: "saved",
        title: "Saved discussion",
        status: "completed",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    loading: false,
    error: null,
    hasMore: false,
    loadingMore: false,
    select: vi.fn(),
    loadMore: vi.fn(),
    retry: vi.fn(),
    refresh: vi.fn(),
    rename: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockRejectedValue(new Error("Wait for the run to finish")),
    clear: vi.fn(),
  };

  vi.stubGlobal("fetch", () => Promise.resolve(new Response()));
  const page = render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(Sidebar, {
        empty: false,
        onNewConversation: vi.fn(),
        history,
        current: {
          threadId: "saved",
          title: "Saved discussion",
          status: "completed",
          busy: false,
        },
      }),
    ),
  );

  return { page, history, client };
}

test("history replaces the current conversation placeholder and keeps one selected entry", () => {
  const { page, client } = renderSidebar();

  try {
    expect(
      page.getByRole("button", { name: "Saved discussion" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      page.queryByText("Current conversation", { exact: true }),
    ).toBeNull();
  } finally {
    client.clear();
  }
});

test("deletion requires confirmation and a rejected delete keeps the conversation usable", async () => {
  const { page, history, client } = renderSidebar();

  try {
    fireEvent.click(
      page.getByRole("button", { name: "Actions for Saved discussion" }),
    );
    fireEvent.click(page.getByRole("button", { name: "Delete" }));
    expect(history.remove).not.toHaveBeenCalled();
    fireEvent.click(page.getByRole("button", { name: "Delete conversation" }));
    expect(await page.findByRole("alert")).toHaveTextContent(
      "Wait for the run to finish",
    );
    expect(
      page.getByRole("button", { name: "Delete conversation" }),
    ).toBeEnabled();
    fireEvent.click(page.getByRole("button", { name: "Cancel" }));
    expect(
      page.getByRole("button", { name: "Saved discussion" }),
    ).toBeEnabled();
  } finally {
    client.clear();
  }
});
