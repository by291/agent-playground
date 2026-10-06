import { EventType, type BaseEvent } from "@ag-ui/client";
import type { Activity } from "./state";

export interface ActivityStream {
  content: string;
  streamId: string;
  events: Activity[];
  partial: boolean;
  status: "open" | "complete" | "stopped";
}

export interface ActivityRow {
  id: string;
  entry: Activity;
  stream?: ActivityStream;
}

const streamTypes = [
  {
    start: EventType.TEXT_MESSAGE_START,
    content: EventType.TEXT_MESSAGE_CONTENT,
    end: EventType.TEXT_MESSAGE_END,
    idField: "messageId",
  },
  {
    start: EventType.REASONING_MESSAGE_START,
    content: EventType.REASONING_MESSAGE_CONTENT,
    end: EventType.REASONING_MESSAGE_END,
    idField: "messageId",
  },
  {
    start: EventType.TOOL_CALL_START,
    content: EventType.TOOL_CALL_ARGS,
    end: EventType.TOOL_CALL_END,
    idField: "toolCallId",
  },
];

interface PositionedRow {
  row: ActivityRow;
  position: number;
}

export function activityRows(
  activity: readonly Activity[],
  merge: boolean,
): ActivityRow[] {
  if (!merge) {
    return activity.map((entry) => ({ id: entry.id, entry }));
  }

  const rows: PositionedRow[] = [];
  const segmentCounts = new Map<string, number>();
  const activeStreams = new Map<
    string,
    {
      runId: string;
      started: boolean;
      positioned?: PositionedRow;
    }
  >();

  function stopStream(positioned: PositionedRow | undefined) {
    const stream = positioned?.row.stream;

    if (stream) {
      stream.status = "stopped";
      stream.partial = true;
    }
  }

  // The store is newest first. Reassemble in receive order, then place each group at its latest delta.
  for (let index = activity.length - 1; index >= 0; index -= 1) {
    const entry = activity[index]!;
    const { event } = entry;
    const definition = streamTypes.find(
      (type) =>
        event.type === type.start ||
        event.type === type.content ||
        event.type === type.end,
    );
    const streamId: unknown = definition
      ? event[definition.idField]
      : undefined;
    const identified =
      definition && typeof streamId === "string" && streamId.length > 0;

    if (
      event.type === EventType.RUN_FINISHED ||
      event.type === EventType.RUN_ERROR
    ) {
      for (const [key, stream] of activeStreams) {
        if (stream.runId === entry.runId) {
          stopStream(stream.positioned);
          activeStreams.delete(key);
        }
      }
    }

    if (identified) {
      const key = JSON.stringify([entry.runId, definition.content, streamId]);
      let stream = activeStreams.get(key);

      if (event.type === definition.start) {
        stopStream(stream?.positioned);
        activeStreams.set(key, { runId: entry.runId, started: true });
      } else if (event.type === definition.end) {
        const merged = stream?.positioned?.row.stream;

        if (merged) {
          merged.status = "complete";
        }

        activeStreams.delete(key);
      } else if (typeof event.delta === "string") {
        if (!stream) {
          stream = { runId: entry.runId, started: false };
          activeStreams.set(key, stream);
        }

        if (!stream.positioned) {
          const segment = segmentCounts.get(key) ?? 0;

          segmentCounts.set(key, segment + 1);
          stream.positioned = {
            position: index,
            row: {
              id: `stream-${key}-${segment}`,
              entry,
              stream: {
                content: "",
                streamId,
                events: [],
                partial: !stream.started,
                status: "open",
              },
            },
          };
          rows.push(stream.positioned);
        }

        const positioned = stream.positioned;
        const merged = positioned.row.stream!;

        positioned.position = index;
        positioned.row.entry = entry;
        merged.content += event.delta;
        merged.events.push(entry);

        continue;
      }
    }

    rows.push({ position: index, row: { id: entry.id, entry } });
  }

  return rows
    .sort((first, second) => first.position - second.position)
    .map(({ row }) => row);
}

export function activityDescription(event: BaseEvent): string | undefined {
  for (const field of ["stepName", "toolCallName", "name", "message"]) {
    if (typeof event[field] === "string") {
      return event[field];
    }
  }

  if (event.type === EventType.RUN_FINISHED) {
    const outcome = event.outcome;

    if (
      outcome &&
      typeof outcome === "object" &&
      "type" in outcome &&
      outcome.type === "interrupt"
    ) {
      return "Run paused";
    }

    return "Run finished";
  }

  if (typeof event.delta === "string") {
    return `${event.delta.length} characters received`;
  }

  if (event.type === EventType.STATE_SNAPSHOT) {
    return "Public state snapshot";
  }

  return undefined;
}
