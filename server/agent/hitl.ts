import type { Interrupt, ResumeEntry } from "@ag-ui/client";
import { LangGraphAgent } from "@ag-ui/langgraph";
import { Client } from "@langchain/langgraph-sdk";
import { prepareAegraRequest } from "../observability/tracing";

export function omitInputOnResume(url: URL, init: RequestInit): RequestInit {
  if (!url.pathname.endsWith("/runs/stream") || typeof init.body !== "string") {
    return init;
  }

  const body: unknown = JSON.parse(init.body);
  if (typeof body !== "object" || body === null || !("command" in body)) {
    return init;
  }
  if (body.command === null || !("input" in body)) return init;

  // Aegra rejects a resume command accompanied by the adapter's state input.
  const resumeBody: Record<string, unknown> = { ...body };
  delete resumeBody.input;
  return { ...init, body: JSON.stringify(resumeBody) };
}

export function aegraClient(apiUrl: string): Client {
  return new Client({
    apiUrl,
    onRequest: (url, init) =>
      prepareAegraRequest(url, omitInputOnResume(url, init)),
  });
}

export class ReviewLangGraphAgent extends LangGraphAgent {
  protected override buildCommandResumeFromAgui(
    entries: readonly ResumeEntry[],
    context: { openInterrupts: Interrupt[] },
  ): unknown {
    if (entries.length <= 1)
      return super.buildCommandResumeFromAgui(entries, context);

    return Object.fromEntries(
      entries.map((entry) => [
        entry.interruptId,
        super.buildCommandResumeFromAgui([entry], context),
      ]),
    );
  }
}
