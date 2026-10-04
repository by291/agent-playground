import {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";
import { z } from "zod";

export const themePreferenceSchema = z.enum(["light", "dark", "system"]);
export const sendShortcutSchema = z.enum(["enter", "modifier-enter"]);
const userPreferencesSchema = z.object({
  theme: themePreferenceSchema.default("light"),
  sendShortcut: sendShortcutSchema.default("enter"),
  replyAnimation: z.boolean().default(true),
});

type UserPreferences = z.infer<typeof userPreferencesSchema>;

const storageKey = "agent-playground-preferences";
const defaults = userPreferencesSchema.parse({});

export function parseUserPreferences(value: string | null): UserPreferences {
  try {
    const parsed = userPreferencesSchema.safeParse(JSON.parse(value ?? "{}"));

    return parsed.success ? parsed.data : defaults;
  } catch {
    return defaults;
  }
}

function loadUserPreferences() {
  try {
    return parseUserPreferences(localStorage.getItem(storageKey));
  } catch {
    return defaults;
  }
}

interface PreferencesValue {
  preferences: UserPreferences;
  updatePreferences: (patch: Partial<UserPreferences>) => void;
  resetPreferences: () => void;
  saved: boolean;
}

const PreferencesContext = createContext<PreferencesValue>({
  preferences: defaults,
  updatePreferences: () => undefined,
  resetPreferences: () => undefined,
  saved: true,
});

export function UserPreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState(loadUserPreferences);
  const [saved, setSaved] = useState(true);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const previousDark = root.classList.contains("dark");
    const previousColorScheme = root.style.colorScheme;
    const applyTheme = () => {
      const dark =
        preferences.theme === "dark" ||
        (preferences.theme === "system" && media?.matches === true);

      root.classList.toggle("dark", dark);
      root.style.colorScheme = dark ? "dark" : "light";
    };

    applyTheme();

    if (preferences.theme === "system") {
      media?.addEventListener("change", applyTheme);
    }

    return () => {
      media?.removeEventListener("change", applyTheme);
      root.classList.toggle("dark", previousDark);
      root.style.colorScheme = previousColorScheme;
    };
  }, [preferences.theme]);

  function updatePreferences(patch: Partial<UserPreferences>) {
    const next = { ...preferences, ...patch };

    setPreferences(next);

    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setSaved(true);
    } catch {
      setSaved(false);
    }
  }

  return (
    <PreferencesContext
      value={{
        preferences,
        updatePreferences,
        resetPreferences: () => updatePreferences(defaults),
        saved,
      }}
    >
      {children}
    </PreferencesContext>
  );
}

export function useUserPreferences() {
  return useContext(PreferencesContext);
}
