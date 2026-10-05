import { useState } from "react";
import type { ActivityStream } from "../model/activity";
import { JsonPayload } from "./JsonPayload";

export function MergedActivityContent({
  stream,
  toolArguments,
}: {
  stream: ActivityStream;
  toolArguments: boolean;
}) {
  const [hasOpenedRaw, setHasOpenedRaw] = useState(false);

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
      <details
        className="motion-details mt-3"
        onToggle={(event) => {
          if (event.currentTarget.open) {
            setHasOpenedRaw(true);
          }
        }}
      >
        <summary className="cursor-pointer rounded-sm py-2 text-xs/6 text-muted focus-visible:outline-2 focus-visible:outline-muted">
          Original events ({stream.events.length})
        </summary>
        {hasOpenedRaw && (
          <JsonPayload
            source={JSON.stringify(
              stream.events.map(({ event }) => event),
              null,
              2,
            )}
          />
        )}
      </details>
    </div>
  );
}
