import clsx from "clsx";

import { inputClass } from "./input-class";

type SelectProps<T extends string> = {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
};

/** A native select: the macOS pop-up menu, with the text field's look. */
export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  className,
}: SelectProps<T>) {
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as T)}
      className={clsx(inputClass, "appearance-auto pr-6 disabled:opacity-45", className)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
