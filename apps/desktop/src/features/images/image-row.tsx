import { IconDots, IconTrash } from "@tabler/icons-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "sonner";

import { formatBytes, formatRelative, plural } from "@/lib/format";
import type { ContainerSummary, ImageSummary } from "@/lib/ipc/bindings";
import { logoFor } from "@/lib/logos";
import { Button } from "@/ui/button";
import { Chip } from "@/ui/chip";
import { rowLink } from "@/ui/classes";
import { Dash } from "@/ui/dash";
import { FaceStack } from "@/ui/face-stack";
import { IconAction } from "@/ui/icon-action";
import { ContextMenu, Menu, type MenuEntry } from "@/ui/menu";
import { Row, RowActions } from "@/ui/table";
import { Tile } from "@/ui/tile";

import { imageName, shortId } from "./model";

export type ImageHandlers = {
  onTag: (image: ImageSummary) => void;
  onDelete: (image: ImageSummary) => void;
};

type ImageRowProps = ImageHandlers & { image: ImageSummary; users: ContainerSummary[] };

function copy(value: string) {
  writeText(value)
    .then(() => toast("Copied", { description: value }))
    .catch(() => undefined);
}

function UsedBy({ image, users }: { image: ImageSummary; users: ContainerSummary[] }) {
  if (users.length === 0 && image.containers > 0) {
    return <span className="text-ink-2">{plural(image.containers, "container")}</span>;
  }
  const faces = users.map((user) => ({
    id: user.id,
    name: user.name,
    running: user.state === "running",
    logo: logoFor(user.image),
  }));
  return <FaceStack faces={faces} />;
}

export function ImageRow({ image, users, onTag, onDelete }: ImageRowProps) {
  const navigate = useNavigate();
  const name = imageName(image);
  const reference = image.references[0] ?? shortId(image.id);
  const inUse = image.containers > 0;
  const menu: MenuEntry[] = [
    { label: "Open", onSelect: () => navigate({ to: "/images/$id", params: { id: image.id } }) },
    { label: "Copy reference", onSelect: () => copy(reference) },
    { label: "Copy ID", onSelect: () => copy(image.id) },
    { kind: "separator" },
    { label: "Tag…", onSelect: () => onTag(image), disabled: image.dangling },
    { kind: "separator" },
    {
      label: inUse ? "Delete (in use)" : "Delete image…",
      danger: true,
      disabled: inUse,
      onSelect: () => onDelete(image),
    },
  ];
  return (
    <ContextMenu entries={menu}>
      <Row dim={image.dangling}>
        <td className="max-w-0">
          <Link to="/images/$id" params={{ id: image.id }} className={rowLink} data-row-link>
            <Tile
              logo={image.dangling ? undefined : logoFor(image.repository)}
              icon={image.dangling ? "layer" : "image"}
            />
            <span className={image.dangling ? "truncate" : "truncate font-medium text-ink"}>
              {name}
            </span>
          </Link>
        </td>
        <td className="max-w-0">
          {image.tag ? (
            <Chip mono className="max-w-full truncate">
              {image.tag}
            </Chip>
          ) : (
            <Dash />
          )}
        </td>
        <td className="font-mono text-mono-12 text-ink-3">{shortId(image.id)}</td>
        <td className="text-right tabular">{formatBytes(image.sizeBytes)}</td>
        <td className="text-ink-3">{formatRelative(image.createdAt)}</td>
        <td className="max-w-0">
          <UsedBy image={image} users={users} />
        </td>
        <RowActions>
          <IconAction
            label={inUse ? "In use, stop its containers first" : "Delete"}
            target={name}
            disabled={inUse}
            onClick={() => onDelete(image)}
          >
            <IconTrash />
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
