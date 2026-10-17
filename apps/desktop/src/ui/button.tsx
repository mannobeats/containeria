import { IconLoader2 } from "@tabler/icons-react";
import clsx from "clsx";
import type { ComponentProps } from "react";

const variants = {
  default:
    "bg-surface text-ink inset-ring-[0.5px] inset-ring-line-strong shadow-[0_1px_1px_light-dark(oklch(0_0_0/0.04),oklch(0_0_0/0.2))] hover:bg-hover active:bg-press",
  ghost: "text-ink-2 hover:bg-hover hover:text-ink aria-pressed:bg-hover aria-pressed:text-ink",
  soft: "bg-fill text-ink hover:bg-hover",
  strong: "bg-strong text-on-strong hover:opacity-90",
  brand: "bg-brand-solid text-white hover:bg-brand-solid-hover",
  danger: "bg-bad text-white hover:brightness-95",
  dangerGhost: "text-bad-ink hover:bg-bad-soft",
} as const;

const sizes = {
  sm: "h-6 gap-1 rounded-[5px] px-2 text-12",
  md: "h-7 gap-1.5 rounded-sm px-2.5 text-13",
  lg: "h-8 gap-1.5 rounded-sm px-3.5 text-13",
} as const;

const iconOnly = {
  sm: "size-6 rounded-[5px]",
  md: "size-7 rounded-sm",
  lg: "size-8 rounded-sm",
} as const;

type ButtonVariant = keyof typeof variants;

type ButtonProps = ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: keyof typeof sizes;
  iconOnly?: boolean;
  loading?: boolean;
};

export function Button({
  variant = "default",
  size = "md",
  iconOnly: isIconOnly = false,
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
      className={clsx(
        "inline-flex shrink-0 items-center justify-center whitespace-nowrap font-medium transition-[background-color,color,transform,box-shadow] duration-140 ease-out active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45 [&_.tabler-icon]:opacity-85",
        variants[variant],
        isIconOnly ? iconOnly[size] : sizes[size],
        className,
      )}
      {...props}
    >
      {loading ? <IconLoader2 className="animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}
