import {
  createContext,
  memo,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ComponentProps,
} from "react";
import {
  Block,
  Streamdown,
  parseMarkdownIntoBlocks,
  type BlockProps,
  type Components,
  type ExtraProps,
} from "streamdown";
import { code } from "@streamdown/code";
import { compactStreamingText, segmentStreamingText } from "./streaming-text";
import { textReveal, usePacedText } from "./usePacedText";
import { useReportReplyPresentation } from "../outputs/ReplyPresentation";
import { knowledgeCitations, KnowledgeCitation } from "./knowledge-citations";
import { markdownCopyAnnotations } from "./markdown-selection";

interface MarkdownProps {
  text: string;
  streaming: boolean;
  onStreamingChange?: ((streaming: boolean) => void) | undefined;
}

interface MarkdownContentProps extends MarkdownProps {
  animated: boolean;
}

const lastBlockContext = createContext(-1);
const markdownPlugins = { code };
const citationPlugins = [knowledgeCitations, markdownCopyAnnotations];
const fadeOptions = {
  animation: "fadeIn",
  duration: textReveal.fadeDurationMs,
  easing: "ease-in-out",
  sep: "word",
  stagger: 0,
} as const;

function FadingSpan({
  node,
  style,
  ...props
}: ComponentProps<"span"> & ExtraProps) {
  // Streamdown resets previous tokens to 0ms on each tick. Keep the original
  // timing until the mounted token finishes, even as later text arrives.
  const [animationStyle] = useState(() =>
    node?.properties["data-sd-animate"]
      ? {
          ...style,
          "--sd-delay": "0ms",
          animationFillMode: "backwards",
        }
      : undefined,
  );
  const chunkId = node?.properties["data-knowledge-citation"];

  if (typeof chunkId === "string") {
    return <KnowledgeCitation chunkId={chunkId} />;
  }

  return <span {...props} style={animationStyle ?? style} />;
}

const components: Components = { span: FadingSpan };

function StreamingBlock(props: BlockProps) {
  const lastBlock = useContext(lastBlockContext);
  const active = props.index === lastBlock;
  const rehypePlugins = useMemo(
    () => {
      const animate = props.animatePlugin?.rehypePlugin;
      const base =
        props.rehypePlugins?.filter((plugin) => plugin !== animate) ?? [];

      if (!active || !animate) {
        return base;
      }

      return /* prettier-ignore */ [
        ...base,
        segmentStreamingText,
        animate,
        compactStreamingText,
      ];
    },
    /* prettier-ignore */ [
      active,
      props.rehypePlugins,
      props.animatePlugin,
    ],
  );

  return (
    <Block
      {...props}
      rehypePlugins={rehypePlugins}
      animatePlugin={active ? (props.animatePlugin ?? null) : null}
    />
  );
}

/** Renders Markdown while limiting token animation to the current streaming block. */
export const MarkdownContent = memo(function MarkdownContent({
  text,
  streaming,
  animated,
}: MarkdownContentProps) {
  const blocks = useMemo(
    () => (streaming ? parseMarkdownIntoBlocks(text) : []),
    [text, streaming],
  );
  const parseBlocks = useMemo(
    () => (markdown: string) =>
      markdown === text ? blocks : parseMarkdownIntoBlocks(markdown),
    [text, blocks],
  );

  return (
    <lastBlockContext.Provider value={blocks.length - 1}>
      <Streamdown
        mode={streaming ? "streaming" : "static"}
        animated={animated ? fadeOptions : false}
        isAnimating={streaming}
        plugins={markdownPlugins}
        codeBlockMaxHeight={480}
        components={components}
        rehypePlugins={citationPlugins}
        BlockComponent={StreamingBlock}
        parseMarkdownIntoBlocksFn={parseBlocks}
      >
        {text}
      </Streamdown>
    </lastBlockContext.Provider>
  );
});

/** Paces a reply before displaying it and reports when its display finishes. */
export default function MarkdownMessage({
  text,
  streaming,
  onStreamingChange,
}: MarkdownProps) {
  const display = usePacedText({ text, isStreaming: streaming });

  useReportReplyPresentation({ isBusy: display.streaming });
  useLayoutEffect(
    () => onStreamingChange?.(display.streaming),
    [onStreamingChange, display.streaming],
  );

  return <MarkdownContent {...display} />;
}
