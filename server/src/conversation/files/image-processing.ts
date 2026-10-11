import sharp from "sharp";
import { SubmissionError } from "../errors.js";

const maxImageDimension = 8192;

export function imageMimeType(data: Buffer): string | null {
  if (
    data.length >= 24 &&
    data.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) &&
    data.toString("ascii", 12, 16) === "IHDR"
  ) {
    return "image/png";
  }

  if (
    data.length >= 4 &&
    data[0] === 0xff &&
    data[1] === 0xd8 &&
    data[2] === 0xff
  ) {
    return "image/jpeg";
  }

  const header = data.toString("ascii", 0, 6);

  if (data.length >= 13 && (header === "GIF87a" || header === "GIF89a")) {
    return "image/gif";
  }

  if (
    data.length >= 20 &&
    data.toString("ascii", 0, 4) === "RIFF" &&
    data.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
}

export async function validateImage(data: Buffer): Promise<void> {
  const image = sharp(data, {
    failOn: "warning",
    limitInputPixels: maxImageDimension * maxImageDimension,
    sequentialRead: true,
  });

  try {
    const metadata = await image.metadata();

    if (
      !metadata.width ||
      !metadata.height ||
      metadata.width > maxImageDimension ||
      metadata.height > maxImageDimension
    ) {
      throw new SubmissionError(
        "Image dimensions must be at most 8192 pixels per side",
        400,
      );
    }

    // Metadata alone can accept truncated data. Decode pixels before admission.
    await image.stats();
  } catch (error) {
    if (error instanceof SubmissionError) {
      throw error;
    }

    throw new SubmissionError(
      "Attach a valid JPEG, PNG, GIF or WebP image",
      400,
    );
  } finally {
    image.destroy();
  }
}

export async function imagePreview(
  data: Buffer,
  thumbnail: boolean,
): Promise<Buffer> {
  if (!imageMimeType(data)) {
    throw new SubmissionError("This file has no image preview", 400);
  }

  const image = sharp(data, {
    failOn: "warning",
    limitInputPixels: maxImageDimension * maxImageDimension,
    sequentialRead: true,
  });

  try {
    const metadata = await image.metadata();

    if (
      !metadata.width ||
      !metadata.height ||
      metadata.width > maxImageDimension ||
      metadata.height > maxImageDimension
    ) {
      throw new SubmissionError(
        "Image dimensions must be at most 8192 pixels per side",
        400,
      );
    }

    const size = thumbnail ? 320 : 2048;

    // Re-encode only supported raster formats; never serve uploaded active content inline.
    return await image
      .rotate()
      .resize({
        width: size,
        height: size,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 85 })
      .toBuffer();
  } catch (error) {
    if (error instanceof SubmissionError) {
      throw error;
    }

    throw new SubmissionError("This file has no image preview", 400);
  } finally {
    image.destroy();
  }
}
