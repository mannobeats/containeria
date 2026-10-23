import { IconCheck } from "@tabler/icons-react";
import clsx from "clsx";
import { ContextMenu as Context, DropdownMenu as Dropdown } from "radix-ui";
import { type ReactNode, useState } from "react";

const surface =
  "z-50 min-w-[200px] origin-(--radix-dropdown-menu-content-transform-origin) rounded-[10px] bg-[light-dark(oklch(0.99_0_0/0.86),oklch(0.27_0.005_255/0.86))] p-[5px] text-13 text-ink shadow-3 backdrop-blur-xl backdrop-saturate-180 animate-pop";

const item =
  "group flex h-[26px] w-full items-center gap-2 whitespace-nowrap rounded-[5px] px-2 text-left outline-none data-disabled:opacity-45 data-highlighted:bg-brand-solid data-highlighted:text-white [&_.tabler-icon]:text-ink-3 data-highlighted:[&_.tabler-icon]:text-white";

const danger = "text-bad-ink [&_.tabler-icon]:text-bad-ink data-highlighted:bg-bad";

export type MenuEntry =
  | {
      kind?: "item";
      label: string;
      icon?: ReactNode;
      kbd?: string;
      danger?: boolean;
      disabled?: boolean;
      checked?: boolean;
      onSelect: () => void;
    }
  | { kind: "separator" }
  | { kind: "label"; label: string };

type Parts = typeof Dropdown | typeof Context;

function labelBefore(entries: MenuEntry[], index: number): string {
  const before = entries[index - 1];
  return before && before.kind !== "separator" ? before.label : "start";
}

function Entries({ parts, entries }: { parts: Parts; entries: MenuEntry[] }) {
  return entries.map((entry, index) => {
    if (entry.kind === "separator") {
      return (
        <parts.Separator
          key={`separator-after-${labelBefore(entries, index)}`}
          className="mx-2 my-[5px] h-[0.5px] bg-line"
        />
      );
    }
    if (entry.kind === "label") {
      return (
        <parts.Label
          key={entry.label}
          className="px-2 pt-1.5 pb-[3px] text-12 font-medium text-ink-3"
        >
          {entry.label}
        </parts.Label>
      );
    }
    return (
      <parts.Item
        key={entry.label}
        className={clsx(item, entry.danger && danger)}
        disabled={entry.disabled ?? false}
        onSelect={entry.onSelect}
      >
        {entry.icon}
        <span className="min-w-0 flex-1 truncate">{entry.label}</span>
        {entry.checked ? <IconCheck aria-label="Selected" /> : null}
        {entry.kbd ? (
          <span className="pl-4 text-12 tracking-[0.04em] text-ink-3 group-data-highlighted:text-white">
            {entry.kbd}
          </span>
        ) : null}
      </parts.Item>
    );
  });
}

type DropdownProps = {
  entries: MenuEntry[];
  align?: "start" | "end";
  children: ReactNode;
};

/** A button-triggered menu. `children` is the trigger, rendered as is. */
export function Menu({ entries, align = "start", children }: DropdownProps) {
  const [open, setOpen] = useState(false);
  return (
    <Dropdown.Root open={open} onOpenChange={setOpen}>
      <Dropdown.Trigger
        asChild
        // Radix opens on pointer-down. Accessibility presses (VoiceOver, Voice Control) send a
        // click with no pointer, detail 0, so open on those too.
        onClick={(event) => {
          if (event.detail === 0) {
            setOpen((current) => !current);
          }
        }}
      >
        {children}
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content align={align} sideOffset={4} collisionPadding={8} className={surface}>
          <Entries parts={Dropdown} entries={entries} />
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

/** A right-click menu over `children`. */
export function ContextMenu({ entries, children }: { entries: MenuEntry[]; children: ReactNode }) {
  return (
    <Context.Root>
      <Context.Trigger asChild>{children}</Context.Trigger>
      <Context.Portal>
        <Context.Content collisionPadding={8} className={surface}>
          <Entries parts={Context} entries={entries} />
        </Context.Content>
      </Context.Portal>
    </Context.Root>
  );
}
