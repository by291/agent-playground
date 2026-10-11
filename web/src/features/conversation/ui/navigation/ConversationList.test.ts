// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
import { createElement } from "react";
import { act, fireEvent, render } from "@testing-library/react";
import type { ConversationHistory } from "../../hooks/useConversationHistory";
import { ConversationList } from "./ConversationList";

function setup() {
  let callback: IntersectionObserverCallback | undefined;
  const observe = vi.fn();
  const disconnect = vi.fn();
  const observer = vi.fn(function (listener: IntersectionObserverCallback) {
    callback = listener;

    return { observe, disconnect };
  });
  const history: ConversationHistory = {
    conversations: [],
    loading: false,
    error: null,
    hasMore: true,
    loadingMore: false,
    select: vi.fn(),
    loadMore: vi.fn(),
    retry: vi.fn(),
    refresh: vi.fn(),
    rename: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
  };

  vi.stubGlobal("IntersectionObserver", observer);
  const element = () =>
    createElement(ConversationList, {
      history,
      threadId: "draft",
      title: "New conversation",
      status: null,
      empty: true,
      collapsed: false,
      onSelect: history.select,
      currentBusy: false,
    });
  const page = render(element());
  const intersect = (visible: boolean, ratio = visible ? 1 : 0) => {
    act(() => {
      callback?.(
        [
          {
            isIntersecting: visible,
            intersectionRatio: ratio,
          } as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      );
    });
  };

  return { page, history, observer, observe, disconnect, element, intersect };
}

test("pagination observes the end of the history scroller without a load more button", () => {
  const { page, history, observer, observe, intersect } = setup();

  expect(observer).toHaveBeenCalledWith(expect.any(Function), {
    root: page.getByLabelText("Conversation history"),
    rootMargin: "0px",
    threshold: 1,
  });
  expect(observe).toHaveBeenCalledOnce();
  expect(page.queryByRole("button", { name: /Load more/ })).toBeNull();
  intersect(false);
  expect(history.loadMore).not.toHaveBeenCalled();
  intersect(true, 0.5);
  expect(history.loadMore).not.toHaveBeenCalled();
  intersect(true);
  expect(history.loadMore).toHaveBeenCalledOnce();
});

test("loading and exhausted history stop observing and unmount releases the observer", () => {
  const { page, history, observer, disconnect, element } = setup();

  history.loadingMore = true;
  page.rerender(element());
  expect(disconnect).toHaveBeenCalledOnce();
  const loading = page.getByRole("status", {
    name: "Loading older conversations",
  });

  expect(loading.querySelector("svg")).toHaveClass("motion-safe:animate-spin");
  expect(page.getByLabelText("Conversation history")).toContainElement(loading);
  expect(observer).toHaveBeenCalledOnce();
  history.loadingMore = false;
  page.rerender(element());
  expect(observer).toHaveBeenCalledTimes(2);
  history.hasMore = false;
  page.rerender(element());
  expect(disconnect).toHaveBeenCalledTimes(2);
  history.hasMore = true;
  page.rerender(element());
  page.unmount();
  expect(disconnect).toHaveBeenCalledTimes(3);
});

test("a failed next page stops automatic loading until an explicit retry", () => {
  const { page, history, observer, disconnect, element, intersect } = setup();

  history.error = "Could not load older conversations";
  page.rerender(element());
  expect(disconnect).toHaveBeenCalledOnce();
  expect(observer).toHaveBeenCalledOnce();
  expect(page.getByRole("alert")).toHaveTextContent(history.error);
  intersect(true);
  expect(history.loadMore).not.toHaveBeenCalled();
  fireEvent.click(page.getByRole("button", { name: "Retry" }));
  expect(history.retry).toHaveBeenCalledOnce();
  expect(history.refresh).not.toHaveBeenCalled();
});
