import { z } from "zod";

const preferenceScope = {
  category: z.literal("preference"),
  project: z.null(),
};
const projectScope = {
  category: z.literal("project"),
  project: z.string().trim().min(1).max(100),
};
const revision = z.number().int().positive().safe();
const text = z.string().trim().min(1).max(1000);
const recordFields = {
  id: z.string().uuid(),
  text,
  sourceThreadId: z.string().max(256).nullable(),
  sourceMessageId: z.string().max(256).nullable(),
  revision,
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
};

export const memorySchema = z.discriminatedUnion("category", [
  z.object({ ...preferenceScope, ...recordFields }),
  z.object({ ...projectScope, ...recordFields }),
]);
export type Memory = z.infer<typeof memorySchema>;

export const memoryPageSchema = z.object({
  items: memorySchema.array(),
  nextOffset: z.number().int().nonnegative().safe().nullable(),
});
export type MemoryPage = z.infer<typeof memoryPageSchema>;

export const memoryMutationSchema = z.discriminatedUnion("category", [
  z.object({ ...preferenceScope, revision }).strict(),
  z.object({ ...projectScope, revision }).strict(),
]);
export type MemoryMutation = z.infer<typeof memoryMutationSchema>;

export const memoryEditSchema = z.discriminatedUnion("category", [
  z.object({ ...preferenceScope, revision, text }).strict(),
  z.object({ ...projectScope, revision, text }).strict(),
]);
export type MemoryEdit = z.infer<typeof memoryEditSchema>;
