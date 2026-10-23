import { IconSearch, IconStarFilled } from "@tabler/icons-react";
import { useDeferredValue, useState } from "react";

import { logoFor } from "@/lib/logos";
import { inputClass } from "@/ui/input-class";
import { Tile } from "@/ui/tile";

import { useHubSearch } from "./api";

type ImageFieldProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  error: string | undefined;
};

/** Type an image reference, or search Docker Hub and pick one. */
export function ImageField({ id, value, onChange, error }: ImageFieldProps) {
  const [focused, setFocused] = useState(false);
  const term = useDeferredValue(value);
  const { data: hits } = useHubSearch(term);
  const suggestions = focused ? (hits ?? []).slice(0, 7) : [];
  return (
    <div className="relative flex flex-col gap-1.5">
      <label htmlFor={id} className="text-13 font-medium text-ink-2">
        Image
      </label>
      <div className="relative flex items-center">
        <IconSearch aria-hidden className="pointer-events-none absolute left-2 text-ink-3" />
        <input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="nginx:alpine, postgres:18, ghcr.io/…"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          className={`${inputClass} pl-7 font-mono text-mono-13`}
        />
      </div>
      {suggestions.length > 0 ? (
        <div
          role="listbox"
          aria-label="Docker Hub"
          className="absolute top-[60px] z-10 w-full rounded-[10px] bg-raised p-1 shadow-3"
        >
          {suggestions.map((hit) => (
            <button
              key={hit.name}
              type="button"
              role="option"
              aria-selected={false}
              onMouseDown={(event) => {
                event.preventDefault();
                onChange(hit.name);
                setFocused(false);
              }}
              className="flex h-9 w-full items-center gap-2.5 rounded-md px-2 text-left hover:bg-hover"
            >
              <Tile logo={logoFor(hit.name)} icon="image" size="sm" />
              <span className="truncate font-mono text-mono-13 text-ink">{hit.name}</span>
              {hit.official ? <span className="text-12 text-brand-ink">Official</span> : null}
              <span className="ml-auto flex shrink-0 items-center gap-1 text-12 text-ink-3 tabular">
                <IconStarFilled aria-hidden className="size-3" />
                {hit.stars.toLocaleString("en")}
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="m-0 text-12 text-bad-ink">
          {error}
        </p>
      ) : null}
    </div>
  );
}
