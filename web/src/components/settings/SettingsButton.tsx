import { GearSixIcon } from "@phosphor-icons/react/dist/csr/GearSix";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import type { SettingsState } from "./settings-context";

export function SettingsButton({ settings }: { settings: SettingsState }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="workspace-toolbar-button size-8 shrink-0"
          aria-label="Open settings"
          aria-haspopup="dialog"
          aria-expanded={settings.open}
          aria-controls={settings.dialogId}
          onClick={(event) => settings.openSettings(event.currentTarget)}
        >
          <GearSixIcon size={18} aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Settings</TooltipContent>
    </Tooltip>
  );
}
