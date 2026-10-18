import { IconDots } from "@tabler/icons-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "sonner";

import type { ContainerSummary, NetworkSummary } from "@/lib/ipc/bindings";
import { logoFor } from "@/lib/logos";
import type { Selection } from "@/lib/use-selection";
import { Button } from "@/ui/button";
import { Chip } from "@/ui/chip";
import { rowLink } from "@/ui/classes";
import { Dash } from "@/ui/dash";
import { FaceStack } from "@/ui/face-stack";
import { ContextMenu, Menu, type MenuEntry } from "@/ui/menu";
import { Row, RowActions, SelectCell } from "@/ui/table";
import { Tile } from "@/ui/tile";

import { undeletable } from "./model";

type NetworkRowProps = {
  network: NetworkSummary;
  containers: ContainerSummary[];
  onDelete: (network: NetworkSummary) => void;
  selection: Selection;
};

export function NetworkRow({ network, containers, onDelete, selection }: NetworkRowProps) {
  const navigate = useNavigate();
  const faces = network.containers.map((name) => {
    const container = containers.find((candidate) => candidate.name === name);
    return {
      id: container?.id ?? name,
      name,
      running: container?.state === "running",
      logo: logoFor(container?.image),
    };
  });
  const subnet = network.subnet;
  const menu: MenuEntry[] = [
    {
      label: "Open",
      onSelect: () => navigate({ to: "/networks/$id", params: { id: network.id } }),
    },
    ...(subnet
      ? [
          {
            label: "Copy Subnet",
            onSelect: () =>
              writeText(subnet)
                .then(() => toast("Copied", { description: subnet }))
                .catch(() => undefined),
          },
        ]
      : []),
    { kind: "separator" },
    network.builtIn
      ? { label: "Built-in Networks Can't Be Deleted", disabled: true, onSelect: () => undefined }
      : { label: "Delete Network…", danger: true, onSelect: () => onDelete(network) },
  ];
  return (
    <ContextMenu entries={menu}>
      <Row
        selected={selection.has(network.id)}
        onClick={(event) => selection.click(network.id, event)}
      >
        <SelectCell
          selection={selection}
          id={network.id}
          label={`Select ${network.name}`}
          blocked={undeletable(network)}
        />
        <td className="max-w-0">
          <Link to="/networks/$id" params={{ id: network.id }} className={rowLink} data-row-link>
            <Tile icon="network" state={network.builtIn ? "off" : "on"} />
            <span className="truncate font-medium text-ink">{network.name}</span>
            {network.builtIn ? <Chip>Built in</Chip> : null}
            {network.project ? <Chip>{network.project}</Chip> : null}
          </Link>
        </td>
        <td>{network.driver}</td>
        <td className="font-mono text-mono-12">{subnet ?? <Dash />}</td>
        <td className="font-mono text-mono-12 text-ink-3">{network.gateway ?? <Dash />}</td>
        <td className="max-w-0">
          <FaceStack faces={faces} max={5} empty="None" />
        </td>
        <RowActions>
          <Menu entries={menu} align="end">
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              aria-label={`More for ${network.name}`}
              className="text-ink-3 hover:text-ink"
            >
              <IconDots />
            </Button>
          </Menu>
        </RowActions>
      </Row>
    </ContextMenu>
  );
}
