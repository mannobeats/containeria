import { useNavigate } from "@tanstack/react-router";
import { useEffect, useEffectEvent } from "react";

import { applyAppearance, useIsDark } from "@/lib/theme";

import { SECTIONS } from "./sections";
import { useUi } from "./ui-store";

/** App-wide ⌘ shortcuts. Each one is also shown, as a `Kbd`, where its action lives. */
export function useShortcuts() {
  const navigate = useNavigate();
  const dark = useIsDark();
  const shortcuts = useEffectEvent((event: KeyboardEvent): (() => void) | undefined => {
    const key = event.key.toLowerCase();
    const ui = useUi.getState();
    if (event.shiftKey) {
      return key === "l" ? () => applyAppearance(dark ? "light" : "dark") : undefined;
    }
    const section = /^[1-6]$/.test(key) ? SECTIONS[Number(key) - 1] : undefined;
    if (section) {
      return () => navigate({ to: section.to }).catch(() => undefined);
    }
    const actions: Record<string, () => void> = {
      k: () => ui.setPaletteOpen(!ui.paletteOpen),
      "\\": ui.toggleSidebar,
      ",": () => navigate({ to: "/settings" }).catch(() => undefined),
    };
    return actions[key];
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const action = event.metaKey ? shortcuts(event) : undefined;
      if (action) {
        event.preventDefault();
        action();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
