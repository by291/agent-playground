import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { maxFileBytes } from "../../../shared/files.js";

const objectRequestTimeoutMs = 30_000;
const maxObjectKeysPerPage = 1_000;

let sharedClient: S3Client | undefined;

function storage() {
  const bucket = process.env.S3_BUCKET;

  if (!bucket) {
    throw new Error("S3_BUCKET is required for file storage");
  }

  sharedClient ??= new S3Client({
    region: process.env.S3_REGION ?? "us-east-1",
    ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
  });

  return { client: sharedClient, bucket };
}

function objectRequestSignal(signal?: AbortSignal) {
  const deadline = AbortSignal.timeout(objectRequestTimeoutMs);

  return signal ? AbortSignal.any([signal, deadline]) : deadline;
}

/** Writes file bytes to the configured object store with a request deadline. */
export async function putObject(key: string, bytes: Buffer) {
  const { client, bucket } = storage();

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: bytes,
      ContentType: "application/octet-stream",
    }),
    { abortSignal: objectRequestSignal() },
  );
}

/** Reads a stored object while bounding the number of bytes held in memory. */
export async function getObject(key: string, size: number): Promise<Buffer> {
  const { client, bucket } = storage();
  const response = await client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      // Include one extra byte so a limited read still detects an oversized object.
      ...(size > 0 ? { Range: `bytes=0-${maxFileBytes}` } : {}),
    }),
    { abortSignal: objectRequestSignal() },
  );

  if (!response.Body) {
    throw new Error("Stored file has no body");
  }

  const stream =
    response.Body.transformToWebStream() as ReadableStream<Uint8Array>;
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const chunk = await reader.read();

      if (chunk.done) {
        break;
      }

      totalBytes += chunk.value.length;

      // Enforce the bound even when the storage endpoint ignores the Range header.
      if (totalBytes > maxFileBytes) {
        throw new Error("Stored file exceeds 10 MiB");
      }

      chunks.push(chunk.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);

    throw error;
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks);
}

/** Removes one object, honoring the worker's cancellation and the request deadline. */
export async function deleteObject(key: string, signal?: AbortSignal) {
  const { client, bucket } = storage();

  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), {
    abortSignal: objectRequestSignal(signal),
  });
}

/** Releases the cached storage client after its callers have drained. */
export function closeObjectStore() {
  sharedClient?.destroy();
  sharedClient = undefined;
}

/** Lists one page of object keys and returns the token for the next page. */
export async function listObjects(
  prefix: string,
  continuationToken?: string,
  signal?: AbortSignal,
) {
  const { client, bucket } = storage();
  const response = await client.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
      MaxKeys: maxObjectKeysPerPage,
    }),
    { abortSignal: objectRequestSignal(signal) },
  );

  return {
    keys:
      response.Contents?.flatMap((object) =>
        object.Key ? [object.Key] : [],
      ) ?? [],
    continuationToken: response.NextContinuationToken,
  };
}
