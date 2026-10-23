import clsx from "clsx";

import { type Appearance, applyAppearance, useAppearance } from "@/lib/theme";

const OPTIONS: { value: Appearance; label: string; preview: string; side: string; bars: string }[] =
  [
    {
      value: "system",
      label: "Automatic",
      preview: "bg-[linear-gradient(110deg,oklch(0.99_0_0)_50%,oklch(0.2_0.005_255)_50%)]",
      side: "bg-[linear-gradient(110deg,oklch(0.94_0.005_255)_50%,oklch(0.25_0.005_255)_50%)]",
      bars: "bg-[oklch(0.6_0.005_255/0.6)]",
    },
    {
      value: "light",
      label: "Light",
      preview: "bg-[oklch(0.99_0_0)]",
      side: "bg-[oklch(0.94_0.005_255)]",
      bars: "bg-[oklch(0.88_0.005_255)]",
    },
    {
      value: "dark",
      label: "Dark",
      preview: "bg-[oklch(0.2_0.005_255)]",
      side: "bg-[oklch(0.25_0.005_255)]",
      bars: "bg-[oklch(0.38_0.005_255)]",
    },
  ];

/** Three window thumbnails, as in macOS Appearance settings. */
export function ThemePicker() {
  const current = useAppearance();
  return (
    <fieldset className="m-0 grid grid-cols-3 gap-3 border-0 p-0">
      <legend className="sr-only">Appearance</legend>
      {OPTIONS.map((option) => {
        const on = option.value === current;
        return (
          <label
            key={option.value}
            className={clsx(
              "flex flex-col items-center gap-2 text-13",
              on ? "font-medium text-ink" : "text-ink-2",
            )}
          >
            <input
              type="radio"
              name="appearance"
              value={option.value}
              checked={on}
              onChange={() => applyAppearance(option.value)}
              className="peer sr-only"
            />
            <span
              aria-hidden
              className={clsx(
                "flex aspect-[16/10] w-full overflow-hidden rounded-md transition-shadow duration-140 peer-focus-visible:shadow-focus",
                option.preview,
                on
                  ? "shadow-[0_0_0_2px_var(--brand)]"
                  : "shadow-[0_0_0_0.5px_var(--line-strong)] hover:shadow-[0_0_0_1px_var(--line-strong)]",
              )}
            >
              <span className={clsx("w-[30%]", option.side)} />
              <span className="flex flex-1 flex-col gap-[5px] px-2 py-2.5">
                <i className={clsx("h-[5px] rounded-[3px]", option.bars)} />
                <i className={clsx("h-[5px] w-[70%] rounded-[3px]", option.bars)} />
                <i className="h-[5px] w-[45%] rounded-[3px] bg-brand" />
              </span>
            </span>
            {option.label}
          </label>
        );
      })}
    </fieldset>
  );
}
