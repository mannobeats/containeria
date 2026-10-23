import { type ReactNode, useRef } from "react";

import { useSlashToSearch } from "@/lib/use-slash-to-search";

import { SearchField } from "./search-field";

type ListToolbarProps = {
  query: string;
  onQuery: (query: string) => void;
  placeholder: string;
  /** A `Segmented` filter, shown before the search field. */
  filter?: ReactNode;
};

/** The row above a list: an optional filter and a search field that `/` focuses. */
export function ListToolbar({ query, onQuery, placeholder, filter }: ListToolbarProps) {
  const search = useRef<HTMLInputElement>(null);
  useSlashToSearch(search);
  return (
    <div className="flex items-center gap-2 px-5 pt-1 pb-3">
      {filter}
      <SearchField
        ref={search}
        value={query}
        onChange={onQuery}
        placeholder={placeholder}
        shortcut="/"
        className="w-[220px]"
      />
    </div>
  );
}
