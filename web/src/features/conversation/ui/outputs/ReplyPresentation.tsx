import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

interface ReplyReport {
  reply: symbol;
  isBusy: boolean;
}

interface ReplyPresentationState {
  busy: boolean;
  report: (status: ReplyReport) => void;
}

const ReplyPresentationContext = createContext<ReplyPresentationState | null>(
  null,
);

/** Tracks whether any mounted reply still has text or animation to present. */
export function ReplyPresentationProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [activeReplies, setActiveReplies] = useState(() => new Set<symbol>());

  const report = useCallback(({ reply, isBusy }: ReplyReport) => {
    setActiveReplies((previous) => {
      if (previous.has(reply) === isBusy) {
        return previous;
      }

      const next = new Set(previous);

      if (isBusy) {
        next.add(reply);
      } else {
        next.delete(reply);
      }

      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ busy: activeReplies.size > 0, report }),
    [activeReplies, report],
  );

  return (
    <ReplyPresentationContext value={value}>
      {children}
    </ReplyPresentationContext>
  );
}

/** Returns the presentation activity that keeps the composer from sending. */
export function useReplyPresentationBusy() {
  return useContext(ReplyPresentationContext)?.busy ?? false;
}

/** Registers a reply with its enclosing presentation provider until it unmounts. */
export function useReportReplyPresentation({ isBusy }: { isBusy: boolean }) {
  const report = useContext(ReplyPresentationContext)?.report;
  const [reply] = useState(() => Symbol("reply"));

  // Publish before paint so a completed run cannot briefly unlock the composer.
  useLayoutEffect(
    () => report?.({ reply, isBusy }),
    /* prettier-ignore */ [
      report,
      reply,
      isBusy,
    ],
  );

  useLayoutEffect(
    () => () => report?.({ reply, isBusy: false }),
    [report, reply],
  );
}
