import { IconArchive, IconDots } from "@tabler/icons-react";
import { Link, useNavigate } from "@tanstack/react-router";

import { formatBytes, formatRelative } from "@/lib/format";
import type { VolumeSummary } from "@/lib/ipc/bindings";
import { Button } from "@/ui/button";
import { Chip } from "@/ui/chip";
import { rowLink } from "@/ui/classes";
import { Dash } from "@/ui/dash";
import { FaceStack } from "@/ui/face-stack";
import { IconAction } from "@/ui/icon-action";
import { ContextMenu, Menu, type MenuEntry } from "@/ui/menu";
import { Row, RowActions } from "@/ui/table";
import { Tile } from "@/ui/tile";

import { volumeName } from "./model";

export type VolumeHandlers = {
  onBackup: (volume: VolumeSummary) => void;
  onClone: (volume: VolumeSummary) => void;
  onDelete: (volume: VolumeSummary) => void;
};

export function VolumeRow({
  volume,
  onBackup,
  onClone,
  onDelete,
}: VolumeHandlers & { volume: VolumeSummary }) {
  const navigate = useNavigate();
  const name = volumeName(volume);
  const faces = volume.usedBy.map((user) => ({
    id: user.containerId,
    name: user.container,
    running: user.running,
  }));
  const menu: MenuEntry[] = [
    {
      label: "Browse files",
      onSelect: () => navigate({ to: "/volumes/$name", params: { name: volume.name } }),
    },
    { kind: "separator" },
    { label: "Back up to .tar.gz…", onSelect: () => onBackup(volume) },
    { label: "Clone…", onSelect: () => onClone(volume) },
    { kind: "separator" },
    { label: "Delete volume…", danger: true, onSelect: () => onDelete(volume) },
  ];
  return (
    <ContextMenu entries={menu}>
      <Row dim={faces.length === 0}>
        <td className="max-w-0">
          <Link
            to="/volumes/$name"
            params={{ name: volume.name }}
            className={rowLink}
            data-row-link
          >
            <Tile icon="volume" />
            <span
              className={
                volume.anonymous
                  ? "truncate font-mono text-mono-12"
                  : "truncate font-medium text-ink"
              }
            >
              {name}
            </span>
            {volume.anonymous ? <Chip>Anonymous</Chip> : null}
          </Link>
        </td>
        <td>{volume.project ? <Chip>{volume.project}</Chip> : <Dash />}</td>
        <td className="max-w-0">
          <FaceStack faces={faces} />
        </td>
        <td className="max-w-0 truncate font-mono text-mono-12 text-ink-3">
          {volume.usedBy[0]?.mountedAt ?? <Dash />}
        </td>
        <td className="text-right tabular">
          {volume.sizeBytes === null ? <Dash /> : formatBytes(volume.sizeBytes)}
        </td>
        <td className="text-ink-3">
          {volume.createdAt ? formatRelative(Date.parse(volume.createdAt) / 1000) : <Dash />}
        </td>
        <RowActions>
          <IconAction label="Back up to .tar.gz" target={name} onClick={() => onBackup(volume)}>
            <IconArchive />
          </IconAction>
          <Menu entries={menu} align="end">
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              aria-label={`More for ${name}`}
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
