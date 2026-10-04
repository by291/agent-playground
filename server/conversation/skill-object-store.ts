import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { maxSkillFileBytes } from "../../shared/skill-files";

let client: S3Client | undefined;

function storage() {
  const bucket = process.env.SKILL_S3_BUCKET;

  if (!bucket) {
    throw new Error("SKILL_S3_BUCKET is required for file storage");
  }

  client ??= new S3Client({
    region: process.env.SKILL_S3_REGION ?? "us-east-1",
    ...(process.env.SKILL_S3_ENDPOINT
      ? { endpoint: process.env.SKILL_S3_ENDPOINT }
      : {}),
    forcePathStyle: process.env.SKILL_S3_FORCE_PATH_STYLE === "true",
  });

  return { client, bucket };
}

export async function putSkillObject(key: string, data: Buffer) {
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

export async function getSkillObject(
  key: string,
  size: number,
): Promise<Buffer> {
  const { client, bucket } = storage();
  const response = await client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ...(size > 0 ? { Range: `bytes=0-${maxSkillFileBytes}` } : {}),
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

      if (length > maxSkillFileBytes) {
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

export async function deleteSkillObject(key: string, signal?: AbortSignal) {
  const { client, bucket } = storage();

  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), {
    abortSignal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
      : AbortSignal.timeout(30_000),
  });
}

export function closeSkillObjectStore() {
  client?.destroy();
  client = undefined;
}
