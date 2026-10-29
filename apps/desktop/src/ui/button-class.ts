import clsx from "clsx";

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

export type ButtonLook = {
  variant?: ButtonVariant | undefined;
  size?: keyof typeof sizes | undefined;
  iconOnly?: boolean | undefined;
};

/** A button's look, for a router `Link` that navigates and should read as a button. */
export function buttonClass({
  variant = "default",
  size = "md",
  iconOnly: isIconOnly = false,
}: ButtonLook = {}) {
  return clsx(
    "inline-flex shrink-0 items-center justify-center whitespace-nowrap font-medium no-underline transition-[background-color,color,transform,box-shadow] duration-140 ease-out focus-visible:shadow-focus active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45 [&_.tabler-icon]:opacity-85",
    variants[variant],
    isIconOnly ? iconOnly[size] : sizes[size],
  );
}
