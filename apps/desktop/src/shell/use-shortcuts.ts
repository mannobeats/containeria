import { useNavigate } from "@tanstack/react-router";
import { useEffect, useEffectEvent } from "react";

import { applyAppearance, useIsDark } from "@/lib/theme";

import { SECTIONS } from "./sections";
import { useUi } from "./ui-store";

/**
 * App-wide ⌘ shortcuts the menu bar doesn't own. Each one is also shown, as a `Kbd`, where its
 * action lives.
 */
export function useShortcuts() {
  const navigate = useNavigate();
  const dark = useIsDark();
  const shortcuts = useEffectEvent((event: KeyboardEvent): (() => void) | undefined => {
    const key = event.key.toLowerCase();
    const ui = useUi.getState();
    if (event.shiftKey) {
      return key === "l" ? () => applyAppearance(dark ? "light" : "dark") : undefined;
    }
    const section = SECTIONS.find((candidate) => candidate.shortcut === `⌘${key}`);
    if (section) {
      return () => navigate({ to: section.to }).catch(() => undefined);
    }
    const actions: Record<string, () => void> = {
      k: () => ui.setPaletteOpen(!ui.paletteOpen),
      "\\": ui.toggleSidebar,
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
