import { IconRosetteDiscountCheck, IconSearch, IconStar } from "@tabler/icons-react";
import clsx from "clsx";

import type { HubImage } from "@/lib/ipc/bindings";
import { logoFor } from "@/lib/logos";
import { Chip } from "@/ui/chip";
import { EmptyState } from "@/ui/empty-state";
import { Tile } from "@/ui/tile";

type HubResultsProps = {
  results: HubImage[] | undefined;
  term: string;
  selected: string | null;
  onSelect: (name: string) => void;
};

/** Docker Hub matches for the term, official images marked. */
export function HubResults({ results, term, selected, onSelect }: HubResultsProps) {
  if (results?.length === 0) {
    return (
      <EmptyState
        art={<IconSearch className="size-5" aria-hidden />}
        title="No match on Docker Hub"
        className="py-7"
      >
        Nothing is called “{term}”. Paste a full reference like ghcr.io/owner/name:tag to pull from
        another registry.
      </EmptyState>
    );
  }
  return (
    <ul
      aria-label="Docker Hub results"
      className="-mx-2 m-0 flex max-h-[300px] list-none flex-col gap-0.5 overflow-auto p-0"
    >
      {results?.map((image) => (
        <li key={image.name}>
          <button
            type="button"
            aria-pressed={selected === image.name}
            onClick={() => onSelect(image.name)}
            className={clsx(
              "flex w-full items-center gap-2.5 rounded-md px-2 py-[7px] text-left transition-colors duration-140 hover:bg-hover",
              selected === image.name && "bg-select inset-ring-1 inset-ring-brand-line",
            )}
          >
            <Tile logo={logoFor(image.name)} icon="image" />
            <span className="flex min-w-0 flex-1 flex-col gap-px">
              <span className="flex items-center gap-2">
                <b className="font-semibold text-ink">{image.name}</b>
                {image.official ? (
                  <Chip tone="brand">
                    <IconRosetteDiscountCheck aria-hidden />
                    Docker Official Image
                  </Chip>
                ) : null}
              </span>
              <span className="truncate text-12 text-ink-3">{image.description}</span>
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 text-12 text-ink-3 tabular">
              <IconStar className="size-3.5" aria-label="Stars" />
              {image.stars.toLocaleString("en")}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
