import type { Preferences } from "@/lib/ipc/bindings";
import { Switch } from "@/ui/switch";

import { useLaunchAtLogin, usePreferences, useSetPreferences } from "./api";
import { SettingsRow, SettingsSection } from "./settings-section";
import { ThemePicker } from "./theme-picker";

type Toggle = { key: keyof Omit<Preferences, "onboarded">; label: string; hint: string };

const MENU_BAR: Toggle[] = [
  {
    key: "keepRunningInMenuBar",
    label: "Keep running in the menu bar",
    hint: "Closing the window leaves Containeria in the menu bar. Containers keep running either way.",
  },
  {
    key: "memoryInMenuBar",
    label: "Memory in the menu bar",
    hint: "Shows how much the engine uses next to the icon.",
  },
];

export function GeneralPane() {
  const { data: preferences } = usePreferences();
  const setPreferences = useSetPreferences();
  const login = useLaunchAtLogin();
  return (
    <>
      <SettingsSection
        title="Appearance"
        note="The accent colour follows the one set in macOS System Settings."
      >
        <SettingsRow block label="Theme">
          <ThemePicker />
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title="Startup">
        <SettingsRow
          label="Open at login"
          hint="Starts Containeria in the menu bar when you log in."
        >
          <Switch label="Open at login" checked={login.enabled} onCheckedChange={login.set} />
        </SettingsRow>
        {preferences
          ? MENU_BAR.map((toggle) => (
              <SettingsRow key={toggle.key} label={toggle.label} hint={toggle.hint}>
                <Switch
                  label={toggle.label}
                  checked={preferences[toggle.key]}
                  onCheckedChange={(on) =>
                    setPreferences.mutate({ ...preferences, [toggle.key]: on })
                  }
                />
              </SettingsRow>
            ))
          : null}
      </SettingsSection>
    </>
  );
}
