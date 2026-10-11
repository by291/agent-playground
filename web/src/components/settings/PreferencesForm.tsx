import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "../ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Switch } from "../ui/switch";
import {
  sendShortcutSchema,
  themePreferenceSchema,
} from "@/shared/preferences/preferences";
import { useUserPreferences } from "@/shared/preferences/UserPreferencesProvider";

export function PreferencesForm({ id }: { id: string }) {
  const { preferences, updatePreferences, saved } = useUserPreferences();

  return (
    <>
      <FieldGroup className="mt-6 gap-0 divide-y divide-line">
        <Field
          orientation="responsive"
          className="pb-5 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
        >
          <FieldContent>
            <FieldLabel htmlFor={`${id}-theme`}>Appearance</FieldLabel>
            <FieldDescription
              id={`${id}-theme-description`}
              className="text-xs/5"
            >
              Choose your workspace colors.
            </FieldDescription>
          </FieldContent>
          <Select
            value={preferences.theme}
            onValueChange={(value) =>
              updatePreferences({
                theme: themePreferenceSchema.parse(value),
              })
            }
          >
            <SelectTrigger
              className="w-full shrink-0 border-line bg-surface sm:w-44 dark:bg-surface dark:hover:bg-sidebar"
              id={`${id}-theme`}
              aria-describedby={`${id}-theme-description`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="end">
              <SelectGroup className="sm:gap-0.5">
                <SelectItem value="light" className="sm:min-h-8 sm:py-1">
                  Light
                </SelectItem>
                <SelectItem value="dark" className="sm:min-h-8 sm:py-1">
                  Dark
                </SelectItem>
                <SelectItem value="system" className="sm:min-h-8 sm:py-1">
                  System
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <Field
          orientation="responsive"
          className="py-5 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
        >
          <FieldContent>
            <FieldLabel htmlFor={`${id}-shortcut`}>Send shortcut</FieldLabel>
            <FieldDescription
              id={`${id}-shortcut-description`}
              className="text-xs/5"
            >
              Shift + Enter always adds a new line.
            </FieldDescription>
          </FieldContent>
          <Select
            value={preferences.sendShortcut}
            onValueChange={(value) =>
              updatePreferences({
                sendShortcut: sendShortcutSchema.parse(value),
              })
            }
          >
            <SelectTrigger
              className="w-full shrink-0 border-line bg-surface sm:w-44 dark:bg-surface dark:hover:bg-sidebar"
              id={`${id}-shortcut`}
              aria-describedby={`${id}-shortcut-description`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="end">
              <SelectGroup className="sm:gap-0.5">
                <SelectItem value="enter" className="sm:min-h-8 sm:py-1">
                  Enter
                </SelectItem>
                <SelectItem
                  value="modifier-enter"
                  className="sm:min-h-8 sm:py-1"
                >
                  Ctrl / Cmd + Enter
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <Field orientation="horizontal" className="items-center pt-5">
          <FieldContent>
            <FieldLabel htmlFor={`${id}-animation`}>Reply animation</FieldLabel>
            <FieldDescription
              id={`${id}-animation-description`}
              className="text-xs/5"
            >
              Reveal replies smoothly. Respects reduced motion.
            </FieldDescription>
          </FieldContent>
          <Switch
            id={`${id}-animation`}
            aria-describedby={`${id}-animation-description`}
            checked={preferences.replyAnimation}
            onCheckedChange={(replyAnimation) =>
              updatePreferences({ replyAnimation })
            }
          />
        </Field>
      </FieldGroup>
      <p
        className="mt-6 text-xs text-muted"
        role={saved ? undefined : "status"}
      >
        {saved
          ? "Saved in this browser."
          : "Changes apply now but could not be saved in this browser."}
      </p>
    </>
  );
}
