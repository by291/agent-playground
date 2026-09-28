import type { ExtraProps } from "streamdown";

type Element = NonNullable<ExtraProps["node"]>;
type Parent = Pick<Element, "children">;

const wordSegmenter = new Intl.Segmenter(undefined, { granularity: "word" });
const excludedTags = new Set(["pre", "code", "svg", "math", "annotation"]);
const wordsPerGroup = 64;
const fadingTailLength = 256;

// Stable groups let old text shed its animation spans without remounting the tail.
function groupText(value: string): Element[] {
  const words = [...wordSegmenter.segment(value)];
  const groups: Element[] = [];

  for (let start = 0; start < words.length; start += wordsPerGroup) {
    const group = words.slice(start, start + wordsPerGroup);
    const last = group.at(-1)!;
    const settled =
      last.index + last.segment.length <= value.length - fadingTailLength;
    const segments = settled
      ? [group.map((word) => word.segment).join("")]
      : group.map((word) => word.segment);

    groups.push({
      type: "element",
      tagName: "span",
      properties: { "data-reveal-settled": settled },
      children: segments.map((segment) => ({ type: "text", value: segment })),
    });
  }

  return groups;
}

function segmentText(parent: Parent) {
  parent.children = parent.children.flatMap((child) => {
    if (child.type === "text" && child.value.trim()) {
      return groupText(child.value);
    }

    if (child.type === "element" && !excludedTags.has(child.tagName)) {
      segmentText(child);
    }

    return [child];
  });
}

function textContent(parent: Parent): string {
  return parent.children
    .map((child) => {
      if (child.type === "text") {
        return child.value;
      }

      return child.type === "element" ? textContent(child) : "";
    })
    .join("");
}

function compactText(parent: Parent) {
  for (const child of parent.children) {
    if (child.type !== "element") {
      continue;
    }

    if (child.properties["data-reveal-settled"]) {
      child.children = [{ type: "text", value: textContent(child) }];
      delete child.properties["data-sd-animated"];
    } else {
      compactText(child);
    }

    delete child.properties["data-reveal-settled"];
  }
}

// Streamdown's word separator only recognizes whitespace. Segment CJK through
// Intl first, then let its native plugin provide the fade and animation timing.
export function segmentStreamingText() {
  return segmentText;
}

export function compactStreamingText() {
  return compactText;
}
