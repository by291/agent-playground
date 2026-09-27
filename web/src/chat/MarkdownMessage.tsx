import { useState } from "react";
import { Streamdown, type AnimateOptions } from "streamdown";
import "streamdown/styles.css";

const streamingAnimation: AnimateOptions = {
  animation: "fadeIn",
  duration: 700,
  easing: "cubic-bezier(0.37, 0.55, 0.86, 0.88)",
  sep: "word",
  stagger: 24,
  maxBacklogMs: 320,
};

const cjkAnimation: AnimateOptions = {
  ...streamingAnimation,
  sep: "char",
  stagger: 16,
};

const cjkText =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

export default function MarkdownMessage({
  text,
  animate,
}: {
  text: string;
  animate: boolean;
}) {
  // Word splitting treats unspaced CJK text as one large fading block.
  const [animation] = useState(() =>
    cjkText.test(text) ? cjkAnimation : streamingAnimation,
  );

  return (
    <Streamdown
      mode={animate ? "streaming" : "static"}
      animated={animate ? animation : false}
      isAnimating={animate}
    >
      {text}
    </Streamdown>
  );
}
