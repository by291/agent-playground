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

class TextStreamAnimator {
  private frameId: number | null = null;
  private lastUpdateTime = Date.now();
  private lastCommitTime = 0;
  private finishBy: number | null = null;
  private targetText: string;
  private currentText: string;

  constructor(
    text: string,
    private readonly commit: (text: string, immediate?: boolean) => void,
  ) {
    this.currentText = text;
    this.targetText = text;
  }

  update(text: string, enabled: boolean, streaming: boolean) {
    const replaced = !text.startsWith(this.targetText);

    this.targetText = text;

    if (streaming) {
      this.finishBy = null;
    } else {
      this.finishBy ??= Date.now() + textReveal.backlogDrainMs;
    }

    if (!enabled || (replaced && !streaming)) {
      this.stop();
      this.currentText = text;
      this.commit(text, true);

      return;
    }

    if (replaced) {
      this.currentText = "";
      this.commit("", true);
    }

    if (this.frameId === null && this.currentText !== text) {
      this.lastUpdateTime = Date.now();
      this.frameId = requestAnimationFrame(this.animate);
    }
  }

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
    const timePerChar = Math.min(
      1000 / textReveal.charsPerSecond,
      textReveal.backlogDrainMs / remaining,
      this.finishBy === null
        ? Infinity
        : Math.max(0, this.finishBy - now) / remaining,
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

export function usePacedText(text: string, streaming: boolean) {
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
      new TextStreamAnimator(frame.text, (nextText, immediate = false) => {
        setFrame((previous) => {
          const unchanged =
            previous.text === nextText &&
            (!immediate || previous.revealedAt === null);

          if (unchanged) {
            return previous;
          }

          return { text: nextText, revealedAt: immediate ? null : Date.now() };
        });
      }),
  );

  if (streaming && !hasStreamed) {
    setHasStreamed(true);
  }

  const enabled = hasStreamed && !reduceMotion && preferences.replyAnimation;

  useEffect(() => {
    animator.update(text, enabled, streaming);
  }, [animator, text, enabled, streaming]);
  useEffect(() => () => animator.stop(), [animator]);
  useEffect(() => {
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
  }, [enabled, streaming, text, frame, settledFrame]);

  if (!enabled) {
    return { text, streaming, animated: false };
  }

  const visible = text.startsWith(frame.text) ? frame.text : "";
  const fading = frame.revealedAt !== null && frame !== settledFrame;

  return {
    text: visible,
    streaming: streaming || visible !== text || fading,
    animated: true,
  };
}
