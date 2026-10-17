import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { toast } from "sonner";

import { commands, type Preferences } from "@/lib/ipc/bindings";
import { errorMessage } from "@/lib/ipc/errors";

const keys = {
  preferences: ["preferences"],
  host: ["host"],
  about: ["about"],
  autostart: ["autostart"],
} as const;

export function usePreferences() {
  return useQuery({ queryKey: keys.preferences, queryFn: commands.preferencesGet });
}

/** Saves at once and shows the new value before the write finishes. */
export function useSetPreferences() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (preferences: Preferences) => commands.preferencesSet(preferences),
    onMutate: (preferences) => client.setQueryData(keys.preferences, preferences),
    onError: (error) => toast.error("Settings weren't saved", { description: errorMessage(error) }),
    onSettled: () => client.invalidateQueries({ queryKey: keys.preferences }),
  });
}

export function useHost() {
  return useQuery({
    queryKey: keys.host,
    queryFn: commands.hostInfo,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useAbout() {
  return useQuery({ queryKey: keys.about, queryFn: commands.about });
}

export function useLaunchAtLogin() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: keys.autostart, queryFn: isEnabled });
  const mutation = useMutation({
    mutationFn: (on: boolean) => (on ? enable() : disable()),
    onSettled: () => client.invalidateQueries({ queryKey: keys.autostart }),
    onError: (error) =>
      toast.error("Launch at login didn't change", { description: errorMessage(error) }),
  });
  return { enabled: query.data ?? false, set: mutation.mutate };
}

/** Asks macOS to allow notifications, when a notification switch is turned on. */
export async function allowNotifications() {
  if (!(await isPermissionGranted())) {
    await requestPermission();
  }
}

/** Tells someone working in another app that a pull, build or Compose run ended. */
export async function notifyWhenAway(title: string, body: string | null) {
  const [focused, preferences] = await Promise.all([
    getCurrentWindow().isFocused(),
    commands.preferencesGet(),
  ]);
  if (!focused && preferences.notifyOn.includes("finished")) {
    sendNotification(body === null ? { title } : { title, body });
  }
}
