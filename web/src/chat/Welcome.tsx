import {
  ArrowRightIcon,
  ChatCircleDotsIcon,
  ClockIcon,
  SparkleIcon,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import type { ChatPaneProps } from "./types";

export function Welcome({ onSend }: { onSend: ChatPaneProps["onSend"] }) {
  return (
    <div className="my-auto w-full py-12 sm:py-20">
      <div className="mb-7 flex size-12 items-center justify-center rounded-2xl border border-accent-line bg-accent-soft text-accent shadow-[0_8px_20px_rgba(49,94,69,0.06)]">
        <SparkleIcon size={25} weight="fill" aria-hidden="true" />
      </div>
      <p className="mb-3 text-[11px] font-semibold tracking-[0.16em] text-accent uppercase">
        Your agent workspace
      </p>
      <h2 className="max-w-xl text-[30px] leading-[1.15] font-semibold tracking-[-0.055em] text-ink sm:text-[38px]">
        A place to think out loud.
      </h2>
      <p className="mt-4 max-w-lg text-[15px]/7 text-muted">
        Ask a question, try a tool call, or explore what happens during an agent
        run.
      </p>

      <div className="mt-10 grid gap-3 sm:grid-cols-2">
        <Suggestion
          icon={<ChatCircleDotsIcon size={21} aria-hidden="true" />}
          title="Start a conversation"
          prompt="What can you help me with?"
          onSend={onSend}
        />
        <Suggestion
          icon={<ClockIcon size={21} aria-hidden="true" />}
          title="Try the time tool"
          prompt="What time is it in UTC right now?"
          onSend={onSend}
        />
        <Suggestion
          icon={<SparkleIcon size={21} aria-hidden="true" />}
          title="Build a visual plan"
          prompt="Create an experiment plan for testing an agent workflow."
          onSend={onSend}
        />
        <Suggestion
          icon={<ChatCircleDotsIcon size={21} aria-hidden="true" />}
          title="Try the MCP tool"
          prompt="Use the MCP tool to add 12 and 30."
          onSend={onSend}
        />
      </div>
    </div>
  );
}

function Suggestion({
  icon,
  title,
  prompt,
  onSend,
}: {
  icon: ReactNode;
  title: string;
  prompt: string;
  onSend: ChatPaneProps["onSend"];
}) {
  return (
    <button
      type="button"
      onClick={() => void onSend(prompt)}
      className="group flex min-h-28 flex-col justify-between rounded-2xl border border-line bg-white p-4 text-left shadow-[0_2px_8px_rgba(28,41,34,0.025)] transition-[border-color,box-shadow] hover:border-accent-line hover:shadow-[0_8px_24px_rgba(28,41,34,0.06)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <div className="flex w-full items-start justify-between text-accent">
        {icon}
        <ArrowRightIcon
          size={17}
          className="text-soft transition-transform group-hover:translate-x-0.5 group-hover:text-accent"
          aria-hidden="true"
        />
      </div>
      <div>
        <p className="text-[13px] font-semibold text-ink">{title}</p>
        <p className="mt-1 text-xs text-muted">{prompt}</p>
      </div>
    </button>
  );
}
