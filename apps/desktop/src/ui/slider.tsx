import { Slider as Radix } from "radix-ui";

type SliderProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** How a value reads, on the right and under each end, like `8 GB` or `1 core`. */
  format: (value: number) => string;
  onChange: (value: number) => void;
};

/** A range with its value read out on the right and the bounds underneath, as in macOS settings. */
export function Slider({ label, value, min, max, step = 1, format, onChange }: SliderProps) {
  return (
    <div className="flex w-full flex-col gap-1.5">
      <div className="flex items-center gap-3.5">
        <Radix.Root
          aria-label={label}
          value={[value]}
          min={min}
          max={max}
          step={step}
          onValueChange={([next]) => onChange(next ?? value)}
          className="relative flex h-[18px] flex-1 touch-none items-center select-none"
        >
          <Radix.Track className="relative h-1 grow overflow-hidden rounded-xs bg-press">
            <Radix.Range className="absolute h-full bg-brand" />
          </Radix.Track>
          <Radix.Thumb className="block size-4 rounded-full bg-white shadow-[0_0_0_0.5px_oklch(0_0_0/0.2),0_1px_3px_oklch(0_0_0/0.3)] outline-none focus-visible:shadow-focus" />
        </Radix.Root>
        <output className="w-[72px] shrink-0 text-right font-medium text-ink tabular">
          {format(value)}
        </output>
      </div>
      <div className="mr-[86px] flex justify-between text-12 text-ink-4 tabular">
        <span>{format(min)}</span>
        <span>{format(max)}</span>
      </div>
    </div>
  );
}
