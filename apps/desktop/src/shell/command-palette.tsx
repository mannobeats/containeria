import { useNavigate } from "@tanstack/react-router";
import { Command } from "cmdk";
import { Dialog } from "radix-ui";
import type { ReactNode } from "react";

import { newDraft } from "@/features/compose/model";
import { chooseComposeFile, useCompose } from "@/features/compose/store";
import { useContainers } from "@/features/containers/api";
import { useRunSheet } from "@/features/containers/run/api";
import { isServing, useEngineControl, useEngineStatus } from "@/features/engine/api";
import { useImageSheet } from "@/features/images/sheet-store";
import { commands } from "@/lib/ipc/bindings";
import { applyAppearance, useIsDark } from "@/lib/theme";
import { CxIcon, type CxIconName } from "@/ui/cx-icon";
import { Kbd } from "@/ui/kbd";

import { SECTIONS } from "./sections";
import { useUi } from "./ui-store";

const itemClass =
  "flex h-9 items-center gap-2.5 rounded-md px-2.5 text-13 text-ink data-[selected=true]:bg-brand-solid data-[selected=true]:text-white [&_.tabler-icon]:text-ink-3 data-[selected=true]:[&_svg]:text-white";

function Item({
  icon,
  label,
  hint,
  onSelect,
}: {
  icon?: CxIconName;
  label: string;
  hint?: ReactNode;
  onSelect: () => void;
}) {
  return (
    <Command.Item value={label} onSelect={onSelect} className={itemClass}>
      {icon ? <CxIcon name={icon} className="text-ink-3" /> : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint}
    </Command.Item>
  );
}

const groupClass =
  "[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-12 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-ink-3";

export function CommandPalette() {
  const open = useUi((state) => state.paletteOpen);
  const setOpen = useUi((state) => state.setPaletteOpen);
  const toggleSidebar = useUi((state) => state.toggleSidebar);
  const navigate = useNavigate();
  const { data: engine } = useEngineStatus();
  const control = useEngineControl();
  const { data: containers } = useContainers();
  const dark = useIsDark();
  const setImageSheet = useImageSheet((state) => state.setSheet);
  const openImages = (sheet: "pull" | "prune") => {
    navigate({ to: "/images" }).catch(() => undefined);
    setImageSheet(sheet);
  };
  const showRunSheet = useRunSheet((state) => state.show);
  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[light-dark(oklch(0.2_0_0/0.08),oklch(0_0_0/0.3))] animate-fade" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-24 left-1/2 z-50 w-[min(640px,calc(100%-48px))] -translate-x-1/2 origin-top overflow-hidden rounded-xl bg-[light-dark(oklch(0.995_0_0/0.9),oklch(0.25_0.005_255/0.92))] shadow-3 backdrop-blur-xl backdrop-saturate-180 animate-pop"
        >
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <Command loop>
            <Command.Input
              autoFocus
              placeholder="Search or run a command"
              className="h-[52px] w-full border-0 border-b-[0.5px] border-line bg-transparent px-4 text-16 text-ink outline-none placeholder:text-ink-4"
            />
            <Command.List className="max-h-[420px] overflow-auto p-1.5">
              <Command.Empty className="px-2.5 py-6 text-center text-13 text-ink-3">
                Nothing matches.
              </Command.Empty>
              <Command.Group heading="Go to" className={groupClass}>
                {SECTIONS.map((section) => (
                  <Item
                    key={section.to}
                    icon={section.icon}
                    label={section.label}
                    hint={section.shortcut ? <Kbd>{section.shortcut}</Kbd> : null}
                    onSelect={run(() => navigate({ to: section.to }))}
                  />
                ))}
              </Command.Group>
              <Command.Group heading="Actions" className={groupClass}>
                <Item
                  icon="container"
                  label="Run container…"
                  hint={<Kbd>⌘N</Kbd>}
                  onSelect={run(showRunSheet)}
                />
                <Item
                  icon="container"
                  label="Deploy Compose project…"
                  hint={<Kbd>⌘⇧N</Kbd>}
                  onSelect={run(() => useCompose.getState().edit(newDraft()))}
                />
                <Item
                  icon="container"
                  label="Open Compose file…"
                  hint={<Kbd>⌘O</Kbd>}
                  onSelect={run(chooseComposeFile)}
                />
              </Command.Group>
              <Command.Group heading="Images" className={groupClass}>
                <Item icon="image" label="Pull image…" onSelect={run(() => openImages("pull"))} />
                <Item
                  icon="image"
                  label="Clean up unused images"
                  onSelect={run(() => openImages("prune"))}
                />
              </Command.Group>
              <Command.Group heading="Engine" className={groupClass}>
                {isServing(engine?.phase) ? (
                  <Item label="Stop engine" onSelect={run(() => control.mutate("stop"))} />
                ) : (
                  <Item label="Start engine" onSelect={run(() => control.mutate("start"))} />
                )}
                <Item label="Restart engine" onSelect={run(() => control.mutate("restart"))} />
                <Item
                  icon="settings"
                  label="Settings…"
                  hint={<Kbd>⌘,</Kbd>}
                  onSelect={run(() => commands.settingsOpen("general").catch(() => undefined))}
                />
              </Command.Group>
              {containers && containers.length > 0 ? (
                <Command.Group heading="Containers" className={groupClass}>
                  {containers
                    .filter((container) => container.pod === null)
                    .map((container) => (
                      <Item
                        key={container.id}
                        icon="container"
                        label={container.name}
                        hint={
                          <span className="text-12 text-ink-3">
                            {container.project ?? container.image}
                          </span>
                        }
                        onSelect={run(() =>
                          navigate({ to: "/containers/$id", params: { id: container.id } }),
                        )}
                      />
                    ))}
                </Command.Group>
              ) : null}
              <Command.Group heading="Window" className={groupClass}>
                <Item label="Toggle sidebar" hint={<Kbd>⌘\</Kbd>} onSelect={run(toggleSidebar)} />
                <Item
                  label={dark ? "Switch to light appearance" : "Switch to dark appearance"}
                  hint={<Kbd>⌘⇧L</Kbd>}
                  onSelect={run(() => applyAppearance(dark ? "light" : "dark"))}
                />
              </Command.Group>
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
