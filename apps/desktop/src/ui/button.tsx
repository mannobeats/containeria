import { IconLoader2 } from "@tabler/icons-react";
import clsx from "clsx";
import type { ComponentProps } from "react";

import { type ButtonLook, buttonClass } from "./button-class";

type ButtonProps = ComponentProps<"button"> & ButtonLook & { loading?: boolean };

export function Button({
  variant,
  size,
  iconOnly: isIconOnly,
  loading = false,
  disabled,
  className,
  children,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={clsx(buttonClass({ variant, size, iconOnly: isIconOnly }), className)}
      {...props}
    >
      {loading ? <IconLoader2 className="animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}
