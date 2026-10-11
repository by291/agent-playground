import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { maxFileBytes } from "../../../shared/files.js";

let client: S3Client | undefined;

function storage() {
  const bucket = process.env.S3_BUCKET;

  if (!bucket) {
    throw new Error("S3_BUCKET is required for file storage");
  }

  client ??= new S3Client({
    region: process.env.S3_REGION ?? "us-east-1",
    ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
  });

  return { client, bucket };
}

export async function putObject(key: string, data: Buffer) {
  const { client, bucket } = storage();

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: data,
      ContentType: "application/octet-stream",
    }),
    { abortSignal: AbortSignal.timeout(30_000) },
  );
}

export async function getObject(key: string, size: number): Promise<Buffer> {
  const { client, bucket } = storage();
  const response = await client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      // Include one extra byte so a limited read still detects an oversized object.
      ...(size > 0 ? { Range: `bytes=0-${maxFileBytes}` } : {}),
    }),
    { abortSignal: AbortSignal.timeout(30_000) },
  );

  if (!response.Body) {
    throw new Error("Stored file has no body");
  }

  const reader = (
    response.Body.transformToWebStream() as ReadableStream<Uint8Array>
  ).getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;

  try {
    while (true) {
      const chunk = await reader.read();

      if (chunk.done) {
        break;
      }

      length += chunk.value.length;

      // Enforce the bound even when the storage endpoint ignores the Range header.
      if (length > maxFileBytes) {
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

export async function deleteObject(key: string, signal?: AbortSignal) {
  const { client, bucket } = storage();

  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), {
    abortSignal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
      : AbortSignal.timeout(30_000),
  });
}

export function closeObjectStore() {
  client?.destroy();
  client = undefined;
}

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
      MaxKeys: 1000,
    }),
    {
      abortSignal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
        : AbortSignal.timeout(30_000),
    },
  );

  return {
    keys:
      response.Contents?.flatMap((object) =>
        object.Key ? [object.Key] : [],
      ) ?? [],
    continuationToken: response.NextContinuationToken,
  };
}
