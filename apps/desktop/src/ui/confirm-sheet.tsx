import type { ReactNode } from "react";

import { Button } from "./button";
import { Sheet } from "./sheet";

type ConfirmSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  action: string;
  onConfirm: () => void;
  pending?: boolean;
};

/** Destructive actions are never one click away: this sheet names exactly what goes. */
export function ConfirmSheet({
  open,
  onOpenChange,
  title,
  children,
  action,
  onConfirm,
  pending = false,
}: ConfirmSheetProps) {
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={children}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="danger" loading={pending} onClick={onConfirm}>
            {action}
          </Button>
        </>
      }
    />
  );
}
