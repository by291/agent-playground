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
    <div className="my-auto w-full py-6 sm:py-8">
      <div className="welcome-intro">
        <div className="mb-5 flex size-11 items-center justify-center rounded-2xl border border-accent-line bg-accent-soft text-accent shadow-sm">
          <SparkleIcon size={23} weight="fill" aria-hidden="true" />
        </div>
        <p className="mb-2 text-xs font-semibold tracking-[0.12em] text-accent uppercase">
          Your agent workspace
        </p>
        <h2 className="max-w-xl text-3xl/tight font-semibold tracking-[-0.045em] text-ink sm:text-4xl">
          A place to think out loud.
        </h2>
        <p className="mt-3 max-w-lg text-[15px]/7 text-muted">
          Ask a question, try a tool call, or explore what happens during an
          agent run.
        </p>
      </div>

      <div className="welcome-suggestions mt-7 grid gap-3 sm:grid-cols-2">
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
      className="group flex min-h-22 items-center gap-3 rounded-2xl border border-line bg-white p-3 text-left shadow-sm transition-[transform,border-color,background-color,box-shadow] duration-200 hover:border-accent-line hover:bg-accent-soft/30 hover:shadow-md motion-safe:hover:-translate-y-0.5 motion-safe:active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold text-ink">
          {title}
        </span>
        <span className="mt-1 block text-xs/5 text-muted">{prompt}</span>
      </span>
      <ArrowRightIcon
        size={17}
        className="shrink-0 text-soft transition-transform group-hover:translate-x-0.5 group-hover:text-accent"
        aria-hidden="true"
      />
    </button>
  );
}
