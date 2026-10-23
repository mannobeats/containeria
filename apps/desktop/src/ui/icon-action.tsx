import type { ReactNode } from "react";

import { Button } from "./button";
import { Tip } from "./tooltip";

type IconActionProps = {
  /** Shown in the tooltip and read by screen readers. */
  label: string;
  /** Extra words for screen readers only, like the name of the row the action applies to. */
  target?: string;
  kbd?: string;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
};

/** A small ghost icon button with a tooltip: the row and toolbar action. */
export function IconAction({
  label,
  target,
  kbd,
  disabled = false,
  onClick,
  children,
}: IconActionProps) {
  return (
    <Tip label={label} {...(kbd ? { kbd } : {})}>
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        aria-label={target ? `${label} ${target}` : label}
        disabled={disabled}
        className="text-ink-3 hover:text-ink"
        {...(onClick ? { onClick } : {})}
      >
        {children}
      </Button>
    </Tip>
  );
}
