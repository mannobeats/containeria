import clsx from "clsx";

import type { Distro } from "@/lib/ipc/bindings";
import { logoFor } from "@/lib/logos";
import { Tile } from "@/ui/tile";

type DistroPickerProps = { distros: Distro[]; value: string; onChange: (id: string) => void };

/** A grid of distributions with their real logos, built on radio inputs. */
export function DistroPicker({ distros, value, onChange }: DistroPickerProps) {
  return (
    <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
      <legend className="mb-1.5 p-0 text-13 font-medium text-ink-2">Distribution</legend>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
        {distros.map((distro) => {
          const selected = distro.id === value;
          return (
            <label
              key={distro.id}
              className={clsx(
                "flex flex-col items-center gap-1 rounded-md px-1.5 pt-2.5 pb-2 text-12 text-ink transition-[background-color,box-shadow] duration-140 has-focus-visible:shadow-focus",
                selected
                  ? "bg-brand-soft shadow-[inset_0_0_0_1.5px_var(--brand)]"
                  : "bg-fill hover:bg-hover",
              )}
            >
              <input
                type="radio"
                name="distro"
                value={distro.id}
                checked={selected}
                onChange={() => onChange(distro.id)}
                className="sr-only"
              />
              <Tile logo={logoFor(distro.id)} icon="machine" size="lg" className="mb-0.5" />
              <b className="font-medium">{distro.name}</b>
              <span className="text-ink-3">{distro.releases[0]?.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
