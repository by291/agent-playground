// @vitest-environment jsdom
import { createElement } from "react";
import { fireEvent, render, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { SelectedAttachment, UploadedAttachments } from "./MessageAttachments";

test("selected images expose a preview and a separate removal action", () => {
  const onRemove = vi.fn();
  const props = { disabled: false, uploading: false, onRemove };
  const view = render(
    createElement(SelectedAttachment, {
      ...props,
      file: new File(["image"], "first.png"),
      preview: "blob:first",
    }),
  );

  expect(view.getByRole("img", { name: "first.png" })).toHaveAttribute(
    "src",
    "blob:first",
  );
  fireEvent.click(view.getByRole("button", { name: "Remove first.png" }));
  expect(onRemove).toHaveBeenCalledOnce();
});

test("a failed thumbnail remains a downloadable file instead of a broken image", () => {
  const view = render(
    createElement(UploadedAttachments, {
      threadId: "saved",
      files: [{ id: "image-id", name: "missing.png" }],
    }),
  );

  fireEvent.error(view.getByRole("img", { name: "missing.png" }));
  expect(view.queryByRole("img")).toBeNull();
  expect(
    view.getByRole("link", { name: "Download missing.png" }),
  ).toHaveAttribute("href", "/conversations/saved/files/image-id");
});

test("saved images form a gallery that starts at the clicked image and downloads the current original", () => {
  const view = render(
    createElement(UploadedAttachments, {
      threadId: "saved",
      files: [
        { id: "first", name: "first.png" },
        { id: "notes", name: "notes.txt" },
        { id: "second", name: "second.png" },
      ],
    }),
  );

  fireEvent.click(view.getByRole("button", { name: "Preview second.png" }));
  const viewer = within(view.getByRole("dialog"));

  expect(viewer.getByText("2 of 2")).toBeVisible();
  expect(
    viewer.getByRole("link", { name: "Download original" }),
  ).toHaveAttribute("href", "/conversations/saved/files/second");
  fireEvent.click(viewer.getByRole("button", { name: "Previous image" }));
  expect(viewer.getByText("1 of 2")).toBeVisible();
  expect(
    viewer.getByRole("link", { name: "Download original" }),
  ).toHaveAttribute("href", "/conversations/saved/files/first");
  expect(viewer.getByRole("button", { name: "Previous image" })).toBeDisabled();
  expect(viewer.getByRole("button", { name: "Zoom in" })).toBeVisible();
  fireEvent.click(viewer.getByRole("button", { name: "Close dialog" }));
  fireEvent.click(view.getByRole("button", { name: "Preview second.png" }));
  expect(within(view.getByRole("dialog")).getByText("2 of 2")).toBeVisible();
});

test("an unavailable full-size preview retains the filename, original download and close control", () => {
  const view = render(
    createElement(UploadedAttachments, {
      threadId: "saved",
      files: [{ id: "first", name: "first.png" }],
    }),
  );

  fireEvent.click(view.getByRole("button", { name: "Preview first.png" }));
  const viewer = within(view.getByRole("dialog", { name: "first.png" }));

  fireEvent.error(viewer.getByRole("img", { name: "first.png" }));

  expect(viewer.getByRole("status")).toHaveTextContent(
    "Image preview is unavailable.",
  );
  expect(
    viewer.getByRole("link", { name: "Download original" }),
  ).toHaveAttribute("href", "/conversations/saved/files/first");
  expect(viewer.getByRole("button", { name: "Close dialog" })).toBeVisible();
});
