// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
import { createElement } from "react";
import { act, render, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SidebarProvider } from "@/components/ui/sidebar";
import { ConversationSidebar } from "./ConversationSidebar";
import { ConversationActionsProvider } from "./ConversationActions";
import type { ConversationHistory } from "../../hooks/useConversationHistory";

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
  const element = (busy = false, generation = "original") =>
    createElement(
      QueryClientProvider,
      { client },
      createElement(
        SidebarProvider,
        null,
        createElement(ConversationActionsProvider, {
          history,
          current: {
            threadId: "saved",
            status: "completed",
            busy,
          },
          children: createElement(ConversationSidebar, {
            key: generation,
            empty: false,
            onNewConversation: vi.fn(),
            history,
            current: {
              threadId: "saved",
              title: "Saved discussion",
              status: "completed",
              busy,
            },
          }),
        }),
      ),
    );
  const page = render(element());

  return { page, history, client, element };
}

test("workspace navigation exposes memory management beside knowledge", () => {
  const { page, client } = renderSidebar();

  expect(page.getByRole("link", { name: "Knowledge" })).toHaveAttribute(
    "href",
    "/knowledge",
  );
  expect(page.getByRole("link", { name: "Memory" })).toHaveAttribute(
    "href",
    "/memory",
  );
  page.unmount();
  client.clear();
});

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
  const user = userEvent.setup();
  const { page, history, client } = renderSidebar();

  try {
    const trigger = page.getByRole("button", {
      name: "Actions for Saved discussion",
    });

    await user.click(
      page.getByRole("button", { name: "Actions for Saved discussion" }),
    );
    await user.click(page.getByRole("menuitem", { name: "Delete" }));
    const confirmation = page.getByRole("alertdialog", {
      name: "Delete conversation?",
    });

    expect(history.remove).not.toHaveBeenCalled();
    await user.click(
      within(confirmation).getByRole("button", { name: "Delete conversation" }),
    );
    expect(await page.findByRole("alert")).toHaveTextContent(
      "Wait for the run to finish",
    );
    expect(
      page.getByRole("button", { name: "Delete conversation" }),
    ).toBeEnabled();
    await user.click(page.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(confirmation).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(
      page.getByRole("button", { name: "Saved discussion" }),
    ).toBeEnabled();
  } finally {
    client.clear();
  }
});

test("keyboard actions open rename and return focus without opening another conversation", async () => {
  const user = userEvent.setup();
  const { page, history, client } = renderSidebar();
  const trigger = page.getByRole("button", {
    name: "Actions for Saved discussion",
  });

  try {
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    await waitFor(() =>
      expect(page.getByRole("menuitem", { name: "Rename" })).toHaveFocus(),
    );
    await user.keyboard("{ArrowDown}");
    expect(page.getByRole("menuitem", { name: "Delete" })).toHaveFocus();
    await user.keyboard("{ArrowUp}{Enter}");
    const rename = page.getByRole("dialog", { name: "Rename conversation" });

    expect(page.queryByRole("menu")).toBeNull();
    await waitFor(() =>
      expect(
        within(rename).getByRole("textbox", { name: "Conversation title" }),
      ).toHaveFocus(),
    );
    await user.keyboard("{Escape}");
    await waitFor(() => expect(rename).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(history.select).not.toHaveBeenCalled();
  } finally {
    client.clear();
  }
});

test("rename rejects an empty title, locks dismissal while saving and retains a failed draft for retry", async () => {
  const user = userEvent.setup();
  const { page, history, client } = renderSidebar();
  let reject: (error: Error) => void = () => undefined;

  vi.mocked(history.rename)
    .mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, rejectRequest) => {
          reject = rejectRequest;
        }),
    )
    .mockResolvedValueOnce(undefined);

  try {
    await user.click(
      page.getByRole("button", { name: "Actions for Saved discussion" }),
    );
    await user.click(page.getByRole("menuitem", { name: "Rename" }));
    const rename = page.getByRole("dialog", { name: "Rename conversation" });
    const title = within(rename).getByRole("textbox", {
      name: "Conversation title",
    });

    await user.clear(title);
    await user.click(
      within(rename).getByRole("button", { name: "Save title" }),
    );
    expect(within(rename).getByRole("alert")).toHaveTextContent(
      "Enter a title between 1 and 100 characters.",
    );
    expect(title).toHaveAttribute("aria-invalid", "true");
    expect(history.rename).not.toHaveBeenCalled();
    await user.type(title, "A new title");
    await user.click(
      within(rename).getByRole("button", { name: "Save title" }),
    );
    expect(title).toBeDisabled();
    expect(
      within(rename).getByRole("button", { name: "Cancel" }),
    ).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(rename).toBeVisible();
    await act(() =>
      Promise.resolve(reject(new Error("Could not save the title"))),
    );
    expect(await within(rename).findByRole("alert")).toHaveTextContent(
      "Could not save the title",
    );
    expect(title).toHaveValue("A new title");
    await user.click(
      within(rename).getByRole("button", { name: "Save title" }),
    );
    await waitFor(() => expect(rename).not.toBeInTheDocument());
    expect(history.rename).toHaveBeenCalledWith("saved", "A new title");
    expect(history.rename).toHaveBeenCalledTimes(2);
  } finally {
    client.clear();
  }
});

test("a run becoming busy disables an already open deletion confirmation", async () => {
  const user = userEvent.setup();
  const { page, history, client, element } = renderSidebar();

  try {
    await user.click(
      page.getByRole("button", { name: "Actions for Saved discussion" }),
    );
    await user.click(page.getByRole("menuitem", { name: "Delete" }));
    page.rerender(element(true));
    const confirm = page.getByRole("button", { name: "Delete conversation" });

    expect(confirm).toBeDisabled();
    await user.click(confirm);
    expect(history.remove).not.toHaveBeenCalled();
    expect(page.getByRole("alertdialog")).toHaveTextContent(
      "Wait for the run to finish before deleting.",
    );
  } finally {
    client.clear();
  }
});

test("deletion locks dismissal until its request completes and restores focus after success", async () => {
  const user = userEvent.setup();
  const { page, history, client } = renderSidebar();
  const trigger = page.getByRole("button", {
    name: "Actions for Saved discussion",
  });
  let complete: () => void = () => undefined;

  vi.mocked(history.remove).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );

  try {
    await user.click(trigger);
    await user.click(page.getByRole("menuitem", { name: "Delete" }));
    const confirmation = page.getByRole("alertdialog");

    await user.click(
      within(confirmation).getByRole("button", { name: "Delete conversation" }),
    );
    expect(
      within(confirmation).getByRole("button", { name: "Deleting…" }),
    ).toBeDisabled();
    expect(
      within(confirmation).getByRole("button", { name: "Cancel" }),
    ).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(confirmation).toBeVisible();
    expect(history.remove).toHaveBeenCalledOnce();
    await act(() => Promise.resolve(complete()));
    await waitFor(() => expect(confirmation).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  } finally {
    complete();
    client.clear();
  }
});

test("remounting navigation preserves a pending rename and focuses the replacement trigger after retry", async () => {
  const user = userEvent.setup();
  const { page, history, client, element } = renderSidebar();
  const originalTrigger = page.getByRole("button", {
    name: "Actions for Saved discussion",
  });
  let reject: (error: Error) => void = () => undefined;

  vi.mocked(history.rename)
    .mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, rejectRequest) => {
          reject = rejectRequest;
        }),
    )
    .mockResolvedValueOnce(undefined);

  try {
    await user.click(originalTrigger);
    await user.click(page.getByRole("menuitem", { name: "Rename" }));
    const rename = page.getByRole("dialog", { name: "Rename conversation" });
    const title = within(rename).getByRole("textbox", {
      name: "Conversation title",
    });

    await user.clear(title);
    await user.type(title, "Keep this rename draft");
    await user.click(
      within(rename).getByRole("button", { name: "Save title" }),
    );
    page.rerender(element(false, "replacement"));
    expect(originalTrigger).not.toBeInTheDocument();
    expect(rename).toBeInTheDocument();
    expect(
      within(rename).getByRole("button", { name: "Saving…" }),
    ).toBeDisabled();
    await act(() => Promise.resolve(reject(new Error("Retry this rename"))));
    expect(await within(rename).findByRole("alert")).toHaveTextContent(
      "Retry this rename",
    );
    expect(title).toHaveValue("Keep this rename draft");
    await user.click(
      within(rename).getByRole("button", { name: "Save title" }),
    );
    await waitFor(() => expect(rename).not.toBeInTheDocument());
    await waitFor(() =>
      expect(
        page.getByRole("button", { name: "Actions for Saved discussion" }),
      ).toHaveFocus(),
    );
    expect(history.rename).toHaveBeenCalledWith(
      "saved",
      "Keep this rename draft",
    );
    expect(history.rename).toHaveBeenCalledTimes(2);
  } finally {
    reject(new Error("Finish review fixture"));
    client.clear();
  }
});
