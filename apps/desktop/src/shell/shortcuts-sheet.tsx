import { Kbd } from "@/ui/kbd";
import { Sheet } from "@/ui/sheet";

import { useUi } from "./ui-store";

const GROUPS: { title: string; keys: [string, string][] }[] = [
  {
    title: "Anywhere",
    keys: [
      ["⌘K", "Search or run a command"],
      ["⌘1 – ⌘6", "Containers, Images, Volumes, Networks, Kubernetes, Linux machines"],
      ["⌘\\", "Show or hide the sidebar"],
      ["⌘,", "Settings"],
      ["⌘⇧L", "Switch between light and dark"],
      ["⌘/", "These shortcuts"],
    ],
  },
  {
    title: "Create",
    keys: [
      ["⌘N", "Run a container"],
      ["⌘⇧N", "Deploy a Compose project"],
      ["⌘O", "Open a Compose file"],
      ["⌘B", "Build an image"],
    ],
  },
  {
    title: "In lists and editors",
    keys: [
      ["/", "Filter the list"],
      ["⌘↵", "Run the sheet, or the SQL under the cursor"],
      ["Esc", "Close a sheet or menu"],
    ],
  },
];

/** Every keyboard shortcut, from Help → Keyboard Shortcuts. */
export function ShortcutsSheet() {
  const open = useUi((state) => state.shortcutsOpen);
  const setOpen = useUi((state) => state.setShortcutsOpen);
  return (
    <Sheet open={open} onOpenChange={setOpen} title="Keyboard shortcuts">
      <div className="flex flex-col gap-5">
        {GROUPS.map((group) => (
          <section key={group.title}>
            <h3 className="m-0 mb-1.5 text-12 font-medium text-ink-3">{group.title}</h3>
            <dl className="m-0 grid grid-cols-[96px_minmax(0,1fr)] gap-y-1.5 text-13">
              {group.keys.map(([keys, what]) => (
                <div key={keys} className="contents">
                  <dt>
                    <Kbd>{keys}</Kbd>
                  </dt>
                  <dd className="m-0 text-ink">{what}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Sheet>
  );
}
