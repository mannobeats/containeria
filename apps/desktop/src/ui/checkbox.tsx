import { IconCheck, IconMinus } from "@tabler/icons-react";
import clsx from "clsx";
import { Checkbox as Radix } from "radix-ui";

type CheckboxProps = {
  checked: boolean | "indeterminate";
  onCheckedChange: (checked: boolean) => void;
  label: string;
  className?: string;
  disabled?: boolean;
};

export function Checkbox({
  checked,
  onCheckedChange,
  label,
  className,
  disabled = false,
}: CheckboxProps) {
  return (
    <Radix.Root
      checked={checked}
      disabled={disabled}
      onCheckedChange={(value) => onCheckedChange(value === true)}
      aria-label={label}
      className={clsx(
        "inline-grid size-3.5 shrink-0 disabled:opacity-40 place-content-center rounded-xs bg-surface inset-ring-1 inset-ring-line-strong transition-colors duration-140 focus-visible:shadow-focus data-[state=checked]:bg-brand data-[state=checked]:inset-ring-0 data-[state=indeterminate]:bg-brand data-[state=indeterminate]:inset-ring-0",
        className,
      )}
    >
      <Radix.Indicator className="text-white [&_.tabler-icon]:size-[11px] [&_.tabler-icon]:stroke-[2.5]">
        {checked === "indeterminate" ? <IconMinus aria-hidden /> : <IconCheck aria-hidden />}
      </Radix.Indicator>
    </Radix.Root>
  );
}
