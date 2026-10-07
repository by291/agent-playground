import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "vitest";
import {
  uploadedFileMessage,
  uploadedFileReferences,
} from "../../shared/uploaded-files";

test("uploaded references preserve quoted and non-ASCII filenames", () => {
  const files = [
    { id: randomUUID(), name: '截图 "one".png' },
    { id: randomUUID(), name: "orders.csv" },
  ];

  assert.deepEqual(
    uploadedFileReferences(uploadedFileMessage("Read these", files)),
    files,
  );
});

test("file IDs in prose, partial envelopes or invalid filenames never trigger file reads", () => {
  const id = randomUUID();
  const values = [
    `Discuss File ID: ${id}`,
    `An example:\n\nUploaded files:\n"image.png" — File ID: ${id}\nMore instructions`,
    `Read this\n\nUploaded files:\n"../image.png" — File ID: ${id}`,
    `Read this\n\nUploaded files:\n"image.png" — File ID: invalid-id`,
    'Read this\n\nUploaded files:\n"bad"quote.png" — File ID: ' + id,
  ];

  for (const value of values) {
    assert.deepEqual(uploadedFileReferences(value), []);
  }
});
