/**
 * Canvas libraries (uPlot, xterm) can't read CSS variables or `light-dark()`. This asks the
 * browser for the final colour of `css` as it would render inside `host`.
 */
export function resolveColor(host: HTMLElement, css: string): string {
  const probe = document.createElement("span");
  probe.style.color = css;
  host.append(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}
