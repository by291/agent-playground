import type { ClipboardEvent } from "react";
import type { ExtraProps } from "streamdown";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

type Element = NonNullable<ExtraProps["node"]>;
type Parent = Pick<Element, "children">;

// Streamdown's safe links render as buttons. Keep their source destination on
// a wrapper without replacing the library's navigation or confirmation flow.
export function markdownCopyAnnotations() {
  function annotate(parent: Parent) {
    parent.children = parent.children.map((child) => {
      if (child.type !== "element") {
        return child;
      }

      annotate(child);

      if (child.tagName !== "a" || typeof child.properties.href !== "string") {
        return child;
      }

      return {
        type: "element",
        tagName: "span",
        properties: { "data-markdown-href": child.properties.href },
        children: [child],
      };
    });
  }

  return annotate;
}

const converter = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  emDelimiter: "*",
});

converter.use(gfm);
converter.addRule("streamdownStrong", {
  filter: (node) => node.dataset.streamdown === "strong",
  replacement: (content) => `**${content}**`,
});
converter.addRule("tableCellPipes", {
  filter: ["th", "td"],
  replacement: (content, node) => {
    // Cell content is already Markdown. Escape table delimiters without
    // escaping its formatting or literal backslashes a second time.
    const prefix = node.previousElementSibling ? " " : "| ";
    const cell = content.replace(/\|/g, "\\|").replace(/\n/g, "<br>");

    return `${prefix}${cell} |`;
  },
});

export function copyMarkdownSelection(event: ClipboardEvent<HTMLDivElement>) {
  const root = event.currentTarget;
  const selection = root.ownerDocument.getSelection();

  if (
    !selection ||
    selection.isCollapsed ||
    selection.rangeCount !== 1 ||
    !event.clipboardData
  ) {
    return;
  }

  const range = selection.getRangeAt(0);

  if (
    !root.contains(range.startContainer) ||
    !root.contains(range.endContainer)
  ) {
    return;
  }

  let fragment: Node = range.cloneContents();
  let ancestor =
    range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? (range.commonAncestorContainer as HTMLElement)
      : range.commonAncestorContainer.parentElement;

  // cloneContents omits the common ancestor. Restore its formatting and block
  // ancestry so a selection inside bold text, a list, or code remains Markdown.
  while (ancestor && ancestor !== root) {
    const wrapper = ancestor.cloneNode(false);

    wrapper.appendChild(fragment);
    fragment = wrapper;
    ancestor = ancestor.parentElement;
  }

  const container = root.ownerDocument.createElement("div");

  container.appendChild(fragment);
  container
    .querySelectorAll(
      '[data-streamdown="code-block-header"], [data-streamdown="code-block-actions"], [data-streamdown="table-controls"], [hidden], [aria-hidden="true"]',
    )
    .forEach((node) => node.remove());

  for (const link of container.querySelectorAll("[data-markdown-href]")) {
    const anchor = root.ownerDocument.createElement("a");

    anchor.setAttribute("href", link.getAttribute("data-markdown-href")!);
    link
      .querySelectorAll("a, button")
      .forEach((child) => child.replaceWith(...child.childNodes));
    anchor.append(...link.childNodes);
    link.replaceWith(anchor);
  }

  container
    .querySelectorAll('button:not([data-streamdown="link"])')
    .forEach((button) => {
      if (!button.closest("[data-markdown-href]")) {
        button.remove();
      }
    });

  for (const code of container.querySelectorAll("pre > code")) {
    const language = code
      .closest("[data-language]")
      ?.getAttribute("data-language");
    const lines = code.querySelectorAll(":scope > span");

    if (language) {
      code.className = `language-${language}`;
    }

    if (lines.length) {
      code.textContent = [...lines]
        .map((line) => line.textContent?.replace(/\n$/, "") ?? "")
        .join("\n");
    }
  }

  for (const table of container.querySelectorAll("table")) {
    if (table.querySelector("thead th")) {
      continue;
    }

    // A body-only selection still needs a header to form a valid GFM table.
    const columns = Math.max(
      0,
      ...[...table.rows].map((row) => row.cells.length),
    );
    const header = table.createTHead().insertRow();

    for (let column = 0; column < columns; column++) {
      header.appendChild(root.ownerDocument.createElement("th"));
    }
  }

  const markdown = converter.turndown(container);

  if (!markdown) {
    return;
  }

  event.clipboardData.setData("text/plain", markdown);
  event.preventDefault();
}
