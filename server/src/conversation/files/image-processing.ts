import sharp from "sharp";
import { SubmissionError } from "../errors.js";

const maxImageDimension = 8192;
const thumbnailDimension = 320;
const previewDimension = 2048;
const previewQuality = 85;
const pngSignature = Buffer.from("89504e470d0a1a0a", "hex");
const pngMinimumHeaderSize = 24;
const pngHeaderTypeOffset = 12;
const pngHeaderTypeEnd = 16;
const jpegSignature = Buffer.from("ffd8ff", "hex");
const jpegMinimumHeaderSize = 4;
const gifVersionEnd = 6;
const gifMinimumHeaderSize = 13;
const webpMinimumHeaderSize = 20;
const riffTagEnd = 4;
const webpTagOffset = 8;
const webpTagEnd = 12;

function openRasterImage(bytes: Buffer) {
  return sharp(bytes, {
    failOn: "warning",
    limitInputPixels: maxImageDimension * maxImageDimension,
    sequentialRead: true,
  });
}

async function checkDimensions(image: ReturnType<typeof sharp>) {
  const { width, height } = await image.metadata();
  const hasInvalidDimensions =
    !width ||
    !height ||
    width > maxImageDimension ||
    height > maxImageDimension;

  if (hasInvalidDimensions) {
    throw new SubmissionError(
      "Image dimensions must be at most 8192 pixels per side",
      400,
    );
  }
}

/** Recognizes supported raster signatures; decoding still validates the full file. */
export function imageMimeType(bytes: Buffer): string | null {
  const isPng =
    bytes.length >= pngMinimumHeaderSize &&
    bytes.subarray(0, pngSignature.length).equals(pngSignature) &&
    bytes.toString("ascii", pngHeaderTypeOffset, pngHeaderTypeEnd) === "IHDR";

  if (isPng) {
    return "image/png";
  }

  const isJpeg =
    bytes.length >= jpegMinimumHeaderSize &&
    bytes.subarray(0, jpegSignature.length).equals(jpegSignature);

  if (isJpeg) {
    return "image/jpeg";
  }

  const header = bytes.toString("ascii", 0, gifVersionEnd);

  if (
    bytes.length >= gifMinimumHeaderSize &&
    (header === "GIF87a" || header === "GIF89a")
  ) {
    return "image/gif";
  }

  const isWebp =
    bytes.length >= webpMinimumHeaderSize &&
    bytes.toString("ascii", 0, riffTagEnd) === "RIFF" &&
    bytes.toString("ascii", webpTagOffset, webpTagEnd) === "WEBP";

  if (isWebp) {
    return "image/webp";
  }

  return null;
}

/** Checks image dimensions and decodes pixels before the file enters model input. */
export async function validateImage(bytes: Buffer): Promise<void> {
  const image = openRasterImage(bytes);

  try {
    await checkDimensions(image);

    // Metadata alone can accept truncated bytes. Decode pixels before admission.
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

/** Re-encodes a supported raster image as a bounded WebP preview. */
export async function imagePreview(
  bytes: Buffer,
  options: { isThumbnail: boolean },
): Promise<Buffer> {
  if (!imageMimeType(bytes)) {
    throw new SubmissionError("This file has no image preview", 400);
  }

  const image = openRasterImage(bytes);

  try {
    await checkDimensions(image);

    const size = options.isThumbnail ? thumbnailDimension : previewDimension;

    // Re-encode only supported raster formats; never serve uploaded active content inline.
    const resizedImage = image.rotate().resize({
      width: size,
      height: size,
      fit: "inside",
      withoutEnlargement: true,
    });

    return await resizedImage.webp({ quality: previewQuality }).toBuffer();
  } catch (error) {
    if (error instanceof SubmissionError) {
      throw error;
    }

    throw new SubmissionError("This file has no image preview", 400);
  } finally {
    image.destroy();
  }
}
