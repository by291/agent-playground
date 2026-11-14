import { useEffect, useState } from "react";
import { useMediaQuery } from "@/shared/hooks/useMediaQuery";
import { useUserPreferences } from "@/shared/preferences/UserPreferencesProvider";

// Adapted from assistant-ui's TextStreamAnimator (MIT); see usePacedText.LICENSE.txt.
// https://github.com/assistant-ui/assistant-ui/blob/main/packages/react/src/utils/smooth/useSmooth.ts
export const textReveal = {
  charsPerSecond: 60,
  backlogDrainMs: 2500,
  commitIntervalMs: 34,
  fadeDurationMs: 500,
};

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

interface TextCommitOptions {
  isImmediate?: boolean;
}

interface TextUpdate {
  text: string;
  isEnabled: boolean;
  isStreaming: boolean;
}

class TextStreamAnimator {
  private frameId: number | null = null;
  private lastUpdateTime = Date.now();
  private lastCommitTime = 0;
  private finishBy: number | null = null;
  private targetText: string;
  private currentText: string;

  constructor(
    text: string,
    private readonly commit: (
      text: string,
      options?: TextCommitOptions,
    ) => void,
  ) {
    this.currentText = text;
    this.targetText = text;
  }

  /** Updates the target and preserves the reveal deadline once the stream closes. */
  update({ text, isEnabled, isStreaming }: TextUpdate) {
    const replaced = !text.startsWith(this.targetText);

    this.targetText = text;

    if (isStreaming) {
      this.finishBy = null;
    } else {
      this.finishBy ??= Date.now() + textReveal.backlogDrainMs;
    }

    if (!isEnabled || (replaced && !isStreaming)) {
      this.stop();
      this.currentText = text;
      this.commit(text, { isImmediate: true });

      return;
    }

    if (replaced) {
      this.currentText = "";
      this.commit("", { isImmediate: true });
    }

    if (this.frameId === null && this.currentText !== text) {
      this.lastUpdateTime = Date.now();
      this.frameId = requestAnimationFrame(this.animate);
    }
  }

  /** Releases the pending animation frame when its owner stops presenting. */
  stop() {
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
  }

  private animate = () => {
    const now = Date.now();
    const elapsed = now - this.lastUpdateTime;
    const remaining = this.targetText.length - this.currentText.length;
    const normalTimePerChar = 1000 / textReveal.charsPerSecond;
    const backlogTimePerChar = textReveal.backlogDrainMs / remaining;
    const deadlineTimePerChar =
      this.finishBy === null
        ? Infinity
        : Math.max(0, this.finishBy - now) / remaining;

    // Accelerate for a growing backlog and finish pending text within the deadline
    // once the server stops streaming, while retaining the normal pace otherwise.
    const timePerChar = Math.min(
      normalTimePerChar,
      backlogTimePerChar,
      deadlineTimePerChar,
    );
    const available = Math.min(remaining, Math.floor(elapsed / timePerChar));
    let revealed = 0;

    // Slice at whole graphemes, including emoji sequences and combining marks.
    for (const { index, segment } of segmenter.segment(
      this.targetText.slice(this.currentText.length),
    )) {
      if (index + segment.length > available) {
        break;
      }

      revealed = index + segment.length;
    }

    if (revealed > 0) {
      this.currentText = this.targetText.slice(
        0,
        this.currentText.length + revealed,
      );
      this.lastUpdateTime = now - Math.max(0, elapsed - revealed * timePerChar);
    }

    const complete = this.currentText === this.targetText;

    if (complete || now - this.lastCommitTime >= textReveal.commitIntervalMs) {
      this.lastCommitTime = now;
      this.commit(this.currentText);
    }

    this.frameId = complete ? null : requestAnimationFrame(this.animate);
  };
}

/** Paces live text and tracks the final fade for consumers that wait on presentation. */
export function usePacedText({
  text,
  isStreaming: streaming,
}: {
  text: string;
  isStreaming: boolean;
}) {
  const { preferences } = useUserPreferences();

  // The shared query tracks live changes; Motion's installed hook snapshots the setting.
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [hasStreamed, setHasStreamed] = useState(streaming);
  const [frame, setFrame] = useState<{
    text: string;
    revealedAt: number | null;
  }>(() => ({ text: streaming ? "" : text, revealedAt: null }));
  const [settledFrame, setSettledFrame] = useState(frame);

  const [animator] = useState(
    () =>
      new TextStreamAnimator(
        frame.text,
        (nextText, { isImmediate = false } = {}) => {
          setFrame((previous) => {
            const unchanged =
              previous.text === nextText &&
              (!isImmediate || previous.revealedAt === null);

            if (unchanged) {
              return previous;
            }

            return {
              text: nextText,
              revealedAt: isImmediate ? null : Date.now(),
            };
          });
        },
      ),
  );

  if (streaming && !hasStreamed) {
    setHasStreamed(true);
  }

  const enabled = hasStreamed && !reduceMotion && preferences.replyAnimation;

  useEffect(
    () => {
      animator.update({
        text,
        isEnabled: enabled,
        isStreaming: streaming,
      });
    },
    /* prettier-ignore */ [
      animator,
      text,
      enabled,
      streaming,
    ],
  );

  // The animator can keep a frame queued even after its input stops changing.
  useEffect(() => () => animator.stop(), [animator]);

  useEffect(
    () => {
      if (
        !enabled ||
        streaming ||
        frame.text !== text ||
        frame === settledFrame ||
        frame.revealedAt === null
      ) {
        return;
      }

      // Keep the final streaming block mounted until its most recent fade ends.
      const remaining =
        textReveal.fadeDurationMs - (Date.now() - frame.revealedAt);
      const timer = setTimeout(
        () => setSettledFrame(frame),
        Math.max(0, remaining),
      );

      return () => clearTimeout(timer);
    },
    /* prettier-ignore */ [
      enabled,
      streaming,
      text,
      frame,
      settledFrame,
    ],
  );

  if (!enabled) {
    return {
      text,
      streaming,
      animated: false,
    };
  }

  const visible = text.startsWith(frame.text) ? frame.text : "";
  const fading = frame.revealedAt !== null && frame !== settledFrame;

  return {
    text: visible,
    streaming: streaming || visible !== text || fading,
    animated: true,
  };
}
