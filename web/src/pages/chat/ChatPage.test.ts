// @vitest-environment jsdom
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { ConversationHistory } from "@/features/conversation";
import { ChatPage } from "./ChatPage";

vi.mock("@/layouts/ChatLayout", () => ({
  ChatLayout: ({ history }: { history: ConversationHistory }) =>
    createElement(
      "button",
      {
        onClick: () => {
          deletionCompleted = history.remove("deleted");
        },
      },
      "Delete conversation",
    ),
}));

let deletionCompleted: Promise<void>;

test.each([
  { currentPath: "/c/deleted", expectedPath: "/" },
  { currentPath: "/c/other", expectedPath: "/c/other" },
])(
  "a completed deletion leaves $currentPath at $expectedPath",
  async ({ currentPath, expectedPath }) => {
    const originalUrl = window.location.href;

    window.history.replaceState(null, "", "/c/deleted");
    let completeDelete!: (response: Response) => void;
    const deletion = new Promise<Response>((resolve) => {
      completeDelete = resolve;
    });
    const fetchRequest = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        return deletion;
      }

      return Promise.resolve(
        url === "/conversations"
          ? Response.json({ conversations: [], nextCursor: null })
          : new Response(null, { status: 404 }),
      );
    });

    vi.stubGlobal("fetch", fetchRequest);

    const client = new QueryClient();
    const view = render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(ChatPage, { development: false }),
      ),
    );

    try {
      fireEvent.click(
        view.getByRole("button", { name: "Delete conversation" }),
      );

      act(() => {
        window.history.pushState(null, "", currentPath);
        window.dispatchEvent(new PopStateEvent("popstate"));
      });

      await act(async () => {
        completeDelete(new Response(null, { status: 204 }));
        await deletionCompleted;
      });

      expect(window.location.pathname).toBe(expectedPath);
    } finally {
      view.unmount();
      client.clear();
      window.history.replaceState(null, "", originalUrl);
    }
  },
);
