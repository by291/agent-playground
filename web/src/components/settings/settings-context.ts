import { createContext } from "react";
export interface SettingsState {
  dialogId: string;
  open: boolean;
  openSettings: (trigger?: HTMLButtonElement) => void;
}

export const SettingsContext = createContext<SettingsState | null>(null);
