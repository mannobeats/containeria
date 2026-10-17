import { IconChevronDown } from "@tabler/icons-react";
import clsx from "clsx";

import { inputClass } from "./input-class";

type SelectOption<T extends string> = { value: T; label: string };

type SelectProps<T extends string> = {
  id?: string;
  /** Read by screen readers; show the same words in a visible label too. */
  label: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
};

/** A native select in the text field look: the macOS menu, keyboard and accessibility for free. */
export function Select<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
  disabled = false,
  className,
}: SelectProps<T>) {
  return (
    <span className={clsx("relative flex items-center", className)}>
      <select
        id={id}
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as T)}
        className={clsx(inputClass, "appearance-none pr-7 disabled:opacity-45")}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <IconChevronDown
        aria-hidden
        className="pointer-events-none absolute right-2 size-3.5 text-ink-3"
      />
    </span>
  );
}
