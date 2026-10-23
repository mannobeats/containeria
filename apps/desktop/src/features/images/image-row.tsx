import { IconDots, IconTrash } from "@tabler/icons-react";
import { Link, useNavigate } from "@tanstack/react-router";

import { formatBytes, formatRelative, plural } from "@/lib/format";
import type { ContainerSummary, ImageSummary } from "@/lib/ipc/bindings";
import { logoFor } from "@/lib/logos";
import type { Selection } from "@/lib/use-selection";
import { Button } from "@/ui/button";
import { Chip } from "@/ui/chip";
import { rowLink } from "@/ui/classes";
import { Dash } from "@/ui/dash";
import { FaceStack } from "@/ui/face-stack";
import { IconAction } from "@/ui/icon-action";
import { ContextMenu, Menu } from "@/ui/menu";
import { Row, RowActions, SelectCell } from "@/ui/table";
import { Tile } from "@/ui/tile";

import { type ImageDialog, imageMenu } from "./image-actions";
import { imageName, inUseReason, shortId } from "./model";

export type ImageHandlers = { onDialog: (dialog: ImageDialog) => void };

type ImageRowProps = ImageHandlers & {
  image: ImageSummary;
  users: ContainerSummary[];
  selection: Selection;
};

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

export function ImageRow({ image, users, onDialog, selection }: ImageRowProps) {
  const navigate = useNavigate();
  const name = imageName(image);
  const inUse = image.containers > 0;
  const menu = imageMenu(image, {
    open: () => navigate({ to: "/images/$id", params: { id: image.id } }),
    onDialog,
  });
  return (
    <ContextMenu entries={menu}>
      <Row
        dim={image.dangling}
        selected={selection.has(image.id)}
        onClick={(event) => selection.click(image.id, event)}
      >
        <SelectCell
          selection={selection}
          id={image.id}
          label={`Select ${image.references[0] ?? name}`}
          blocked={inUse ? inUseReason(image.containers) : undefined}
        />
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
            onClick={() => onDialog({ kind: "delete", image })}
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
