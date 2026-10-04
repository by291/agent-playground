import { z } from "zod";

export const maxFileBytes = 10 * 1024 * 1024;
export const filenameSchema = z
  .string()
  .min(1)
  .max(200)
  .refine(
    (name) =>
      name !== "." && name !== ".." && !/[\\/\u0000-\u001f\u007f]/.test(name),
    "Use a filename without separators or control characters",
  );
