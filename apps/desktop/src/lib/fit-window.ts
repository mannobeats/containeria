import { commands } from "@/lib/ipc/bindings";

/**
 * A ref callback that keeps the window exactly as tall as `node`, the way a popover or a Settings
 * pane fits what it shows.
 */
export function fitWindow(node: HTMLElement | null) {
  if (!node) {
    return;
  }
  const observer = new ResizeObserver(() => {
    commands.windowFit(node.offsetHeight).catch(() => undefined);
  });
  observer.observe(node);
  return () => observer.disconnect();
}
