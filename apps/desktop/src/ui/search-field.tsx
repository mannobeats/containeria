import { IconSearch } from "@tabler/icons-react";
import clsx from "clsx";
import type { Ref } from "react";

import { inputClass } from "./input-class";
import { Kbd } from "./kbd";

type SearchFieldProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  shortcut?: string;
  className?: string;
  ref?: Ref<HTMLInputElement>;
};

export function SearchField({
  value,
  onChange,
  placeholder,
  shortcut,
  className,
  ref,
}: SearchFieldProps) {
  return (
    <div className={clsx("relative flex items-center", className)}>
      <IconSearch className="pointer-events-none absolute left-2 text-ink-3" aria-hidden />
      <input
        ref={ref}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className={clsx(
          inputClass,
          "bg-fill pl-7 shadow-none focus:bg-surface [&::-webkit-search-cancel-button]:hidden",
        )}
      />
      {shortcut && !value ? (
        <Kbd className="pointer-events-none absolute right-1.5">{shortcut}</Kbd>
      ) : null}
    </div>
  );
}
