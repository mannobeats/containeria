import clsx from "clsx";
import { Dialog } from "radix-ui";
import type { ReactNode } from "react";

type SheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  footer?: ReactNode;
  width?: "md" | "lg";
  children?: ReactNode;
};

/** A modal that drops from the top of the window, like a macOS sheet. */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  footer,
  width = "md",
  children,
}: SheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-scrim animate-fade" />
        <Dialog.Content
          className={clsx(
            "fixed top-[52px] left-1/2 z-40 flex max-h-[calc(100%-80px)] -translate-x-1/2 flex-col overflow-hidden rounded-lg bg-surface shadow-3 animate-sheet-in",
            width === "md" ? "w-[min(560px,calc(100%-48px))]" : "w-[min(760px,calc(100%-48px))]",
          )}
        >
          <div className="flex flex-col gap-1 px-5 pt-4 pb-3">
            <Dialog.Title className="m-0 text-16 font-semibold text-ink">{title}</Dialog.Title>
            {description ? (
              <Dialog.Description className="m-0 text-13 text-ink-3">
                {description}
              </Dialog.Description>
            ) : (
              <Dialog.Description className="sr-only">{title}</Dialog.Description>
            )}
          </div>
          {children ? <div className="min-h-0 overflow-auto px-5 pt-1 pb-5">{children}</div> : null}
          {footer ? (
            <div className="flex items-center justify-end gap-2 border-t-[0.5px] border-line bg-panel-solid px-5 py-3">
              {footer}
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
