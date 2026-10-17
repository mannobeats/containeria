/** Where the system menu of Copy, Paste and Look Up still helps: text and the terminal. */
const KEEPS_CONTEXT_MENU = "input, textarea, [contenteditable], .selectable, .xterm";

/**
 * What makes the page behave like a Mac app rather than a website: focus rings only while the
 * keyboard drives it, and no WebKit menu offering Reload or Back on right-click.
 */
export function behaveNatively() {
  const root = document.documentElement;
  addEventListener(
    "keydown",
    (event) => {
      if (!event.metaKey) {
        root.dataset.input = "keyboard";
      }
    },
    true,
  );
  addEventListener(
    "pointerdown",
    () => {
      delete root.dataset.input;
    },
    true,
  );
  addEventListener("contextmenu", (event) => {
    if (!(event.target instanceof Element && event.target.closest(KEEPS_CONTEXT_MENU))) {
      event.preventDefault();
    }
  });
}
