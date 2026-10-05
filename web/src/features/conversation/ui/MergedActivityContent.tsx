import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import type { ActivityStream } from "../model/activity";
import { JsonPayload } from "./JsonPayload";

export function MergedActivityContent({
  stream,
  toolArguments,
}: {
  stream: ActivityStream;
  toolArguments: boolean;
}) {
  return (
    <div className="mt-3">
      <p className="text-xs text-muted">
        {toolArguments ? "Tool call ID" : "Message ID"}
      </p>
      <code className="mt-1 block break-all text-xs/5 text-ink">
        {stream.streamId}
      </code>
      <p className="mt-3 text-xs font-medium text-ink">Merged content</p>
      {stream.partial && (
        <p className="mt-1 text-xs/5 text-activity-state">
          Only retained deltas are available. Earlier content or its closing
          boundary may be missing.
        </p>
      )}
      {toolArguments && (
        <JsonPayload source={stream.content} label="Merged content" />
      )}
      {!toolArguments && (
        <pre
          aria-label="Merged content"
          className="mt-2 max-h-96 overflow-auto rounded-md bg-sidebar p-3 font-mono text-[13px]/6 wrap-anywhere whitespace-pre-wrap text-ink"
        >
          {stream.content}
        </pre>
      )}
      <Collapsible className="mt-3">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm">
            Original events ({stream.events.length})
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent keepMounted>
          <JsonPayload
            source={JSON.stringify(
              stream.events.map(({ event }) => event),
              null,
              2,
            )}
          />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
