import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { RunAgentInput } from "@ag-ui/client";
import sharp from "sharp";
import { beforeEach, test, vi } from "vitest";
import { SubmissionError } from "./errors";

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  synchronize: vi.fn(),
  admit: vi.fn<typeof import("./run-store").admitRun>(),
  claim: vi.fn(),
}));

vi.mock("./skill-files", () => ({ readSkillFile: mocks.readFile }));
vi.mock("./checkpoint-sync", () => ({
  synchronizeConversation: mocks.synchronize,
}));
vi.mock("./run-store", () => ({
  admitRun: mocks.admit,
  claimPreparedDispatch: mocks.claim,
  recordAegraRun: vi.fn(),
}));

const { prepareConversationRun } = await import("./service");
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  "base64",
);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.claim.mockResolvedValue(vi.fn());
});

function submission(files: { id: string; name: string }[] = []): RunAgentInput {
  const references = files.map(
    (file) => `${JSON.stringify(file.name)} — File ID: ${file.id}`,
  );
  const content = files.length
    ? `Read this screenshot.\n\nUploaded files:\n${references.join("\n")}`
    : "Hello";

  return {
    threadId: "image-test",
    runId: randomUUID(),
    messages: [{ id: randomUUID(), role: "user", content }],
    state: {},
    tools: [],
    context: [],
  };
}

test("uploaded images reach the official multimodal adapter while admission keeps file references", async () => {
  const image = { id: randomUUID(), name: 'screen "one".bin' };
  const csv = { id: randomUUID(), name: "orders.csv" };
  const input = submission([image, csv]);

  mocks.readFile.mockImplementation((_threadId, id) =>
    Promise.resolve(
      id === image.id
        ? { ...image, data: png }
        : { ...csv, data: Buffer.from("amount\n20") },
    ),
  );
  const { input: prepared } = await prepareConversationRun(input);

  assert.deepEqual(prepared.messages[0]?.content, [
    { type: "text", text: input.messages[0]?.content },
    {
      type: "image",
      source: {
        type: "data",
        mimeType: "image/png",
        value: png.toString("base64"),
      },
    },
  ]);
  assert.equal(mocks.readFile.mock.calls.length, 2);
  assert.ok(
    mocks.readFile.mock.calls.every(([thread]) => thread === input.threadId),
  );
  assert.deepEqual(mocks.admit.mock.calls[0]?.[0].request, input);
  assert.equal(
    mocks.admit.mock.calls[0]?.[0].userMessage?.content,
    input.messages[0]?.content,
  );
  assert.equal(typeof input.messages[0]?.content, "string");
});

test("only the latest user turn loads images; previous archived references are not resent", async () => {
  const old = submission([{ id: randomUUID(), name: "old.png" }]);
  const input = submission();

  input.messages.unshift(...old.messages);
  const { input: prepared } = await prepareConversationRun(input);

  assert.equal(mocks.readFile.mock.calls.length, 0);
  assert.deepEqual(prepared.messages, input.messages);
});

test("ordinary file attachments and text stay text-only", async () => {
  const csv = { id: randomUUID(), name: "orders.csv" };
  const input = submission([csv]);

  mocks.readFile.mockResolvedValue({ ...csv, data: Buffer.from("amount\n20") });
  const { input: prepared } = await prepareConversationRun(input);

  assert.equal(prepared.messages[0]?.content, input.messages[0]?.content);
});

test.each(["jpeg", "png", "gif", "webp"] as const)(
  "decoded %s images use their actual format regardless of filename",
  async (format) => {
    const file = { id: randomUUID(), name: "screenshot.bin" };
    const data = await sharp(png).toFormat(format).toBuffer();

    mocks.readFile.mockResolvedValue({ ...file, data });
    const { input: prepared } = await prepareConversationRun(
      submission([file]),
    );

    assert.ok(Array.isArray(prepared.messages[0]?.content));
    assert.deepEqual(prepared.messages[0].content[1], {
      type: "image",
      source: {
        type: "data",
        mimeType: `image/${format}`,
        value: data.toString("base64"),
      },
    });
  },
);

test("oversized image dimensions fail before admission", async () => {
  const file = { id: randomUUID(), name: "wide.png" };
  const data = await sharp({
    create: { width: 8193, height: 1, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();

  mocks.readFile.mockResolvedValue({ ...file, data });

  await assert.rejects(
    prepareConversationRun(submission([file])),
    /8192 pixels/,
  );
  assert.equal(mocks.admit.mock.calls.length, 0);
});

test("missing or foreign files fail before admission", async () => {
  const input = submission([{ id: randomUUID(), name: "private.png" }]);

  mocks.readFile.mockRejectedValue(new SubmissionError("File not found", 404));

  await assert.rejects(prepareConversationRun(input), /File not found/);
  assert.equal(mocks.admit.mock.calls.length, 0);
  assert.equal(mocks.claim.mock.calls.length, 0);
});

test("invalid image bytes are reported before admission", async () => {
  const file = { id: randomUUID(), name: "broken.png" };

  mocks.readFile.mockResolvedValue({
    ...file,
    data: Buffer.from("not an image"),
  });

  await assert.rejects(
    prepareConversationRun(submission([file])),
    /valid JPEG, PNG, GIF or WebP/,
  );
  assert.equal(mocks.admit.mock.calls.length, 0);
});

test.each([
  ["truncated.jpg", Buffer.from("ffd8ffd9", "hex")],
  ["truncated.png", png.subarray(0, 24)],
])("truncated image %s is rejected before admission", async (name, data) => {
  const file = { id: randomUUID(), name };

  mocks.readFile.mockResolvedValue({ ...file, data });

  await assert.rejects(
    prepareConversationRun(submission([file])),
    /valid JPEG, PNG, GIF or WebP/,
  );
  assert.equal(mocks.admit.mock.calls.length, 0);
});

test("attachment names must match stored metadata", async () => {
  const file = { id: randomUUID(), name: "screen.png" };

  mocks.readFile.mockResolvedValue({ name: "another.png", data: png });

  await assert.rejects(
    prepareConversationRun(submission([file])),
    /name does not match/,
  );
  assert.equal(mocks.admit.mock.calls.length, 0);
});

test("more than four attachment references fail without reading storage", async () => {
  const input = submission(
    Array.from({ length: 5 }, (_, index) => ({
      id: randomUUID(),
      name: `${index}.png`,
    })),
  );

  await assert.rejects(prepareConversationRun(input), /at most four/);
  assert.equal(mocks.readFile.mock.calls.length, 0);
  assert.equal(mocks.admit.mock.calls.length, 0);
});

test("large image batches fail before base64 expansion and admission", async () => {
  const files = Array.from({ length: 4 }, (_, index) => ({
    id: randomUUID(),
    name: `${index}.png`,
  }));
  const data = Buffer.alloc(10 * 1024 * 1024);

  png.copy(data);
  mocks.readFile.mockImplementation((_threadId, id) =>
    Promise.resolve({ ...files.find((file) => file.id === id), data }),
  );

  await assert.rejects(prepareConversationRun(submission(files)), /32 MiB/);
  assert.equal(mocks.admit.mock.calls.length, 0);
});

test("workflow review images fail explicitly instead of being silently ignored", async () => {
  const file = { id: randomUUID(), name: "review.png" };
  const input = submission([file]);

  input.resume = [
    {
      interruptId: "review",
      status: "resolved",
      payload: {
        workflowCallId: "sql",
        revision: 1,
        round: 1,
        action: "message",
        messageId: input.messages[0]!.id,
        message: input.messages[0]!.content,
      },
    },
  ];
  mocks.readFile.mockResolvedValue({ ...file, data: png });

  await assert.rejects(prepareConversationRun(input), /regular chat/);
  assert.equal(mocks.admit.mock.calls.length, 0);
});
