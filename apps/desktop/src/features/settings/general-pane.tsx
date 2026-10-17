import type { NotifyOn, Preferences } from "@/lib/ipc/bindings";
import { Switch } from "@/ui/switch";

import { allowNotifications, useLaunchAtLogin, usePreferences, useSetPreferences } from "./api";
import { withNotification } from "./model";
import { SettingsRow, SettingsSection } from "./settings-section";
import { ThemePicker } from "./theme-picker";

type Toggle = {
  label: string;
  hint: string;
  read: (preferences: Preferences) => boolean;
  write: (preferences: Preferences, on: boolean) => Preferences;
};

type Flag = "keepRunningInMenuBar" | "memoryInMenuBar";

const flag = (key: Flag, label: string, hint: string): Toggle => ({
  label,
  hint,
  read: (preferences) => preferences[key],
  write: (preferences, on) => ({ ...preferences, [key]: on }),
});

const notice = (kind: NotifyOn, label: string, hint: string): Toggle => ({
  label,
  hint,
  read: (preferences) => preferences.notifyOn.includes(kind),
  write: (preferences, on) => withNotification(preferences, kind, on),
});

const MENU_BAR = [
  flag(
    "keepRunningInMenuBar",
    "Keep running in the menu bar",
    "Closing the window leaves Containeria in the menu bar. Containers keep running either way.",
  ),
  flag(
    "memoryInMenuBar",
    "Memory in the menu bar",
    "Shows how much the engine uses next to the icon.",
  ),
];

const NOTIFICATIONS = [
  notice("crash", "A container crashes", "It exits with an error, not because you stopped it."),
  notice("unhealthy", "A health check fails", "A container's health check reports it unhealthy."),
  notice(
    "finished",
    "A pull, build or Compose run finishes",
    "Only while you're working in another app.",
  ),
  notice(
    "lowMemory",
    "Memory runs low",
    "Containers use more than 90% of the engine's memory. At most every 10 minutes.",
  ),
];

type ToggleRowsProps = { toggles: Toggle[]; onEnable?: () => void };

function ToggleRows({ toggles, onEnable }: ToggleRowsProps) {
  const { data: preferences } = usePreferences();
  const setPreferences = useSetPreferences();
  if (!preferences) {
    return null;
  }
  return toggles.map((toggle) => (
    <SettingsRow key={toggle.label} label={toggle.label} hint={toggle.hint}>
      <Switch
        label={toggle.label}
        checked={toggle.read(preferences)}
        onCheckedChange={(on) => {
          if (on) {
            onEnable?.();
          }
          setPreferences.mutate(toggle.write(preferences, on));
        }}
      />
    </SettingsRow>
  ));
}

const askForNotifications = () => {
  allowNotifications().catch(() => undefined);
};

export function GeneralPane() {
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
        <ToggleRows toggles={MENU_BAR} />
      </SettingsSection>
      <SettingsSection
        title="Notifications"
        note="Containeria notifies you even with its window closed, while it runs in the menu bar."
      >
        <ToggleRows toggles={NOTIFICATIONS} onEnable={askForNotifications} />
      </SettingsSection>
    </>
  );
}
