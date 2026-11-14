import { z } from "zod";

export const themePreferenceSchema = z.enum(
  /* prettier-ignore */ [
    "light",
    "dark",
    "system",
  ],
);
export const sendShortcutSchema = z.enum(["enter", "modifier-enter"]);
const userPreferencesSchema = z.object({
  theme: themePreferenceSchema.default("light"),
  sendShortcut: sendShortcutSchema.default("enter"),
  replyAnimation: z.boolean().default(true),
});

export type UserPreferences = z.infer<typeof userPreferencesSchema>;

export const storageKey = "agent-playground-preferences";
export const defaults = userPreferencesSchema.parse({});

/** Decodes stored preferences and restores defaults when storage is invalid. */
export function parseUserPreferences(value: string | null): UserPreferences {
  try {
    const parsed = userPreferencesSchema.safeParse(JSON.parse(value ?? "{}"));

    return parsed.success ? parsed.data : defaults;
  } catch {
    return defaults;
  }
}
