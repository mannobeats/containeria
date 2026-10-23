import clsx from "clsx";
import { m } from "motion/react";
import { useId } from "react";

type SegmentedOption<T extends string> = { value: T; label: string; count?: number };

type SegmentedProps<T extends string> = {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  size?: "sm" | "md";
};

/** A macOS segmented control, built on radio inputs so arrow keys move between options. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  size = "md",
}: SegmentedProps<T>) {
  const name = useId();
  return (
    <fieldset className="relative m-0 inline-flex isolate rounded-[7px] border-0 bg-fill p-0.5">
      <legend className="sr-only">{label}</legend>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <label
            key={option.value}
            className={clsx(
              "relative inline-flex items-center gap-[5px] whitespace-nowrap rounded-[5px] text-12 font-medium transition-colors duration-140 has-focus-visible:shadow-focus",
              size === "md" ? "h-6 px-2.5" : "h-5 px-2",
              selected ? "text-ink" : "text-ink-3 hover:text-ink",
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={selected}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {selected ? (
              <m.span
                layoutId={`${name}-thumb`}
                transition={{ type: "spring", bounce: 0.15, duration: 0.3 }}
                className="absolute inset-0 -z-10 rounded-[5px] bg-raised shadow-1"
              />
            ) : null}
            {option.label}
            {option.count === undefined ? null : (
              <span className="font-[450] text-ink-3 tabular">{option.count}</span>
            )}
          </label>
        );
      })}
    </fieldset>
  );
}
