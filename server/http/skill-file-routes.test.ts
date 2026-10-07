import assert from "node:assert/strict";
import sharp from "sharp";
import { beforeEach, test, vi } from "vitest";
import { SubmissionError } from "../conversation/errors";

const mocks = vi.hoisted(() => ({ readFile: vi.fn() }));

vi.mock("../conversation/skill-files", () => ({
  readSkillFile: mocks.readFile,
  storeSkillFile: vi.fn(),
}));

const { skillFileRoutes } = await import("./skill-file-routes");

beforeEach(() => {
  vi.resetAllMocks();
});

test("preview serves a bounded decoded image while downloads retain original bytes", async () => {
  const data = await sharp({
    create: { width: 640, height: 480, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();

  mocks.readFile.mockResolvedValue({ name: "screen.png", data });
  const thumbnail = await skillFileRoutes.request(
    "/conversations/chat/files/image/preview?size=thumbnail",
  );

  assert.equal(thumbnail.status, 200);
  assert.equal(thumbnail.headers.get("Content-Type"), "image/webp");
  assert.equal(thumbnail.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(thumbnail.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(mocks.readFile.mock.calls[0], ["chat", "image"]);
  const metadata = await sharp(
    Buffer.from(await thumbnail.arrayBuffer()),
  ).metadata();

  assert.equal(metadata.width, 320);
  assert.equal(metadata.height, 240);
  const download = await skillFileRoutes.request(
    "/conversations/chat/files/image",
  );

  assert.match(download.headers.get("Content-Disposition") ?? "", /attachment/);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), data);
});

test("preview rejects foreign files, active documents and corrupt images", async () => {
  mocks.readFile.mockRejectedValueOnce(
    new SubmissionError("File not found", 404),
  );
  const foreign = await skillFileRoutes.request(
    "/conversations/other/files/image/preview",
  );

  assert.equal(foreign.status, 404);

  for (const data of [
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  ]) {
    mocks.readFile.mockResolvedValue({ name: "screen.png", data });
    const response = await skillFileRoutes.request(
      "/conversations/chat/files/image/preview",
    );

    assert.equal(response.status, 400);
    assert.match(
      response.headers.get("Content-Type") ?? "",
      /application\/json/,
    );
  }
});
