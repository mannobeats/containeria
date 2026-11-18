import { IconArrowUpCircle } from "@tabler/icons-react";

import { openSettings } from "@/features/settings/api";

import { useUpdateFound } from "./api";

/** In the sidebar once a newer Contena is found: opens Settings → About, where it is installed. */
export function UpdateNotice() {
  const { data: update } = useUpdateFound();
  if (!update) {
    return null;
  }
  return (
    <button
      type="button"
      onClick={() => openSettings("about")}
      className="mb-2 flex h-7 w-full items-center gap-[7px] rounded-[7px] bg-brand-soft px-2 text-13 font-medium text-brand-ink [&_.tabler-icon]:size-4"
    >
      <IconArrowUpCircle aria-hidden />
      <span className="truncate">Update to {update.version}</span>
    </button>
  );
}
