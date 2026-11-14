import { useContext } from "react";
import { SettingsContext } from "./settings-context";
import { SettingsButton } from "./SettingsButton";
import { SettingsProvider } from "./SettingsProvider";

/** Opens the shared settings dialog or supplies one for a standalone screen. */
export function SettingsControl({
  onClearConversations,
}: {
  onClearConversations?: (() => Promise<void>) | undefined;
}) {
  const settings = useContext(SettingsContext);

  if (settings) {
    return <SettingsButton settings={settings} />;
  }

  return <SettingsProvider onClearConversations={onClearConversations} />;
}
