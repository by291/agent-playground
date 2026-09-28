import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

interface ReplyPresentationState {
  busy: boolean;
  report: (reply: symbol, busy: boolean) => void;
}

const ReplyPresentationContext = createContext<ReplyPresentationState | null>(
  null,
);

export function ReplyPresentationProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [activeReplies, setActiveReplies] = useState(() => new Set<symbol>());
  const report = useCallback((reply: symbol, busy: boolean) => {
    setActiveReplies((previous) => {
      if (previous.has(reply) === busy) {
        return previous;
      }

      const next = new Set(previous);

      if (busy) {
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

export function useReplyPresentationBusy() {
  return useContext(ReplyPresentationContext)?.busy ?? false;
}

export function useReportReplyPresentation(busy: boolean) {
  const report = useContext(ReplyPresentationContext)?.report;
  const [reply] = useState(() => Symbol("reply"));

  // Publish before paint so a completed run cannot briefly unlock the composer.
  useLayoutEffect(() => report?.(reply, busy), [report, reply, busy]);
  useLayoutEffect(() => () => report?.(reply, false), [report, reply]);
}
