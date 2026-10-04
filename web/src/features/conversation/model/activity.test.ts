import { test, expect } from "vitest";
import { EventType } from "@ag-ui/client";
import { activityDescription, activityRows } from "./activity";
import type { Activity } from "./state";
import type { BaseEvent } from "@ag-ui/client";

function entries(events: BaseEvent[], runId = "run-a"): Activity[] {
  return events
    .map((event, index) => ({
      id: `${runId}-${index}`,
      receivedAt: 1000 + index,
      runId,
      event,
    }))
    .reverse();
}

test("diagnostic descriptions use official step and tool names and preserve error messages", () => {
  expect(
    activityDescription({ type: EventType.STEP_STARTED, stepName: "model" }),
  ).toBe("model");
  expect(
    activityDescription({
      type: EventType.TOOL_CALL_START,
      toolCallName: "get_current_time",
      toolCallId: "time",
    }),
  ).toBe("get_current_time");
  expect(
    activityDescription({
      type: EventType.RUN_ERROR,
      message: "Upstream connection failed",
    }),
  ).toBe("Upstream connection failed");
  expect(
    activityDescription({
      type: EventType.RUN_FINISHED,
      outcome: { type: "interrupt", interrupts: [] },
    }),
  ).toBe("Run paused");
});

test("merged content preserves receive order and separates interleaved text, reasoning and tool streams", () => {
  const activity = entries([
    {
      type: EventType.TEXT_MESSAGE_START,
      messageId: "text",
      role: "assistant",
    },
    {
      type: EventType.REASONING_MESSAGE_START,
      messageId: "reason",
      role: "reasoning",
    },
    {
      type: EventType.TOOL_CALL_START,
      toolCallId: "tool",
      toolCallName: "inspect",
    },
    {
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: "text",
      delta: "Hello ",
    },
    {
      type: EventType.REASONING_MESSAGE_CONTENT,
      messageId: "reason",
      delta: "Think ",
    },
    { type: EventType.TOOL_CALL_ARGS, toolCallId: "tool", delta: '{"count":' },
    { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "text", delta: "world" },
    {
      type: EventType.REASONING_MESSAGE_CONTENT,
      messageId: "reason",
      delta: "first",
    },
    { type: EventType.TOOL_CALL_ARGS, toolCallId: "tool", delta: "2}" },
    { type: EventType.TEXT_MESSAGE_END, messageId: "text" },
    { type: EventType.REASONING_MESSAGE_END, messageId: "reason" },
    { type: EventType.TOOL_CALL_END, toolCallId: "tool" },
  ]);
  const before = JSON.stringify(activity);
  const rows = activityRows(activity, true);
  const streams = rows.filter((row) => row.stream);

  expect(rows).toHaveLength(9);
  expect(streams.map((row) => row.stream?.content)).toEqual([
    '{"count":2}',
    "Think first",
    "Hello world",
  ]);
  expect(
    streams.every(
      (row) =>
        row.stream?.events.length === 2 &&
        !row.stream.partial &&
        row.stream.status === "complete",
    ),
  ).toBe(true);
  expect(streams[0]?.stream?.events.map((entry) => entry.event.delta)).toEqual([
    '{"count":',
    "2}",
  ]);
  expect(JSON.stringify(activity)).toBe(before);
  expect(activityRows(activity, false).map((row) => row.entry)).toEqual(
    activity,
  );
});

test("merged streams do not cross runs or restarted message boundaries and keep stable IDs as content arrives", () => {
  const first = entries([
    {
      type: EventType.TEXT_MESSAGE_START,
      messageId: "same",
      role: "assistant",
    },
    { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "same", delta: "one" },
    { type: EventType.TEXT_MESSAGE_END, messageId: "same" },
    {
      type: EventType.TEXT_MESSAGE_START,
      messageId: "same",
      role: "assistant",
    },
    { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "same", delta: "two" },
  ]);
  const second = entries(
    [
      {
        type: EventType.TEXT_MESSAGE_START,
        messageId: "same",
        role: "assistant",
      },
      {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: "same",
        delta: "other run",
      },
    ],
    "run-b",
  );
  const streams = activityRows([...second, ...first], true).filter(
    (row) => row.stream,
  );

  expect(streams.map((row) => row.stream?.content)).toEqual([
    "other run",
    "two",
    "one",
  ]);
  const live = activityRows(first, true).find(
    (row) => row.stream?.content === "two",
  )!;
  const extra: Activity = {
    id: "new-delta",
    receivedAt: 1006,
    runId: "run-a",
    event: {
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: "same",
      delta: " more",
    },
  };
  const updated = activityRows([extra, ...first], true).find(
    (row) => row.stream?.content === "two more",
  )!;

  expect(updated.id).toBe(live.id);
  expect(updated.entry).toBe(extra);
  expect(updated.stream?.status).toBe("open");
});

test("truncated or cleared streams are marked partial and unknown delta payloads stay individual", () => {
  const activity = entries([
    {
      type: EventType.REASONING_MESSAGE_CONTENT,
      messageId: "reason",
      delta: "tail",
    },
    { type: EventType.REASONING_MESSAGE_END, messageId: "reason" },
    { type: EventType.CUSTOM, name: "custom", delta: "a" },
    { type: EventType.CUSTOM, name: "custom", delta: "b" },
    { type: EventType.TEXT_MESSAGE_CONTENT, delta: "unidentified a" },
    { type: EventType.TEXT_MESSAGE_CONTENT, delta: "unidentified b" },
  ]);
  const rows = activityRows(activity, true);
  const stream = rows.find((row) => row.stream)!;

  expect(rows).toHaveLength(6);
  expect(stream.stream?.content).toBe("tail");
  expect(stream.stream?.partial).toBe(true);
  expect(rows.filter((row) => row.stream)).toHaveLength(1);
});

test("a merged row keeps its identity when the retention window drops its earliest deltas", () => {
  const activity = entries([
    {
      type: EventType.TEXT_MESSAGE_START,
      messageId: "long",
      role: "assistant",
    },
    {
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: "long",
      delta: "first ",
    },
    {
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: "long",
      delta: "middle ",
    },
    { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "long", delta: "tail" },
  ]);
  const complete = activityRows(activity, true).find((row) => row.stream)!;
  const retained = activityRows(activity.slice(0, 2), true).find(
    (row) => row.stream,
  )!;

  expect(retained.id).toBe(complete.id);
  expect(retained.stream?.content).toBe("middle tail");
  expect(retained.stream?.partial).toBe(true);
});

test("a terminal run stops an unterminated stream and a repeated start separates received content", () => {
  const rows = activityRows(
    entries([
      {
        type: EventType.TEXT_MESSAGE_START,
        messageId: "same",
        role: "assistant",
      },
      {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: "same",
        delta: "first",
      },
      {
        type: EventType.TEXT_MESSAGE_START,
        messageId: "same",
        role: "assistant",
      },
      {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: "same",
        delta: "second",
      },
      { type: EventType.RUN_ERROR, message: "connection lost" },
    ]),
    true,
  );
  const streams = rows.filter((row) => row.stream);

  expect(streams.map((row) => row.stream?.content)).toEqual([
    "second",
    "first",
  ]);
  expect(
    streams.every(
      (row) => row.stream?.status === "stopped" && row.stream.partial,
    ),
  ).toBe(true);
});
