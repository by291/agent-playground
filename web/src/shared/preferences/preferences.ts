import { z } from "zod";

export const themePreferenceSchema = z.enum(["light", "dark", "system"]);
export const sendShortcutSchema = z.enum(["enter", "modifier-enter"]);
const userPreferencesSchema = z.object({
  theme: themePreferenceSchema.default("light"),
  sendShortcut: sendShortcutSchema.default("enter"),
  replyAnimation: z.boolean().default(true),
});

export type UserPreferences = z.infer<typeof userPreferencesSchema>;

export const storageKey = "agent-playground-preferences";
export const defaults = userPreferencesSchema.parse({});

export function parseUserPreferences(value: string | null): UserPreferences {
  try {
    const parsed = userPreferencesSchema.safeParse(JSON.parse(value ?? "{}"));

    return parsed.success ? parsed.data : defaults;
  } catch {
    return defaults;
  }
}
