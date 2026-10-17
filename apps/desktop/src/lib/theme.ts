import { useSyncExternalStore } from "react";

import { type Appearance, commands } from "@/lib/ipc/bindings";

export type { Appearance } from "@/lib/ipc/bindings";

const KEY = "containeria.appearance";
const media = matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<() => void>();

function getAppearance(): Appearance {
  const stored = localStorage.getItem(KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

/** Applies the saved appearance before the first paint, then follows changes. */
export function applyAppearance(appearance: Appearance = getAppearance()) {
  const root = document.documentElement;
  if (appearance === "system") {
    delete root.dataset.theme;
    localStorage.removeItem(KEY);
  } else {
    root.dataset.theme = appearance;
    localStorage.setItem(KEY, appearance);
  }
  commands.appSetAppearance(appearance).catch(() => undefined);
  for (const listener of listeners) {
    listener();
  }
}

/** Re-applies the appearance when another window, such as the main one, changes it. */
export function followAppearance() {
  addEventListener("storage", (event) => {
    if (event.key === KEY) {
      applyAppearance();
    }
  });
}

function isDark(): boolean {
  const theme = document.documentElement.dataset.theme;
  return theme === "dark" || (theme === undefined && media.matches);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  media.addEventListener("change", listener);
  return () => {
    listeners.delete(listener);
    media.removeEventListener("change", listener);
  };
}

export function useIsDark(): boolean {
  return useSyncExternalStore(subscribe, isDark);
}

export function useAppearance(): Appearance {
  return useSyncExternalStore(subscribe, getAppearance);
}
