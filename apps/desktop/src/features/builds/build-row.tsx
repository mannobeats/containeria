import { IconDots } from "@tabler/icons-react";
import { Link, useNavigate } from "@tanstack/react-router";

import { formatRelative } from "@/lib/format";
import type { BuildRecord } from "@/lib/ipc/bindings";
import { Button } from "@/ui/button";
import { rowLink } from "@/ui/classes";
import { Dash } from "@/ui/dash";
import { ContextMenu, Menu } from "@/ui/menu";
import { Progress } from "@/ui/progress";
import { Row, RowActions } from "@/ui/table";
import { Tile } from "@/ui/tile";

import { useRemoveBuild } from "./api";
import { buildMenu } from "./build-menu";
import { BuildStatusLabel } from "./build-status";
import {
  buildName,
  buildProgress,
  buildTileState,
  cachedLabel,
  elapsed,
  formatDuration,
} from "./model";

function Duration({ build, now }: { build: BuildRecord; now: number }) {
  const time = <span className="tabular">{formatDuration(elapsed(build, now))}</span>;
  if (build.status !== "running") {
    return time;
  }
  return (
    <span className="flex items-center justify-end gap-2.5">
      <Progress
        value={buildProgress(build)}
        label={`${buildName(build)} progress`}
        className="w-20"
      />
      {time}
    </span>
  );
}

export function BuildRow({ build, now }: { build: BuildRecord; now: number }) {
  const navigate = useNavigate();
  const remove = useRemoveBuild();
  const name = buildName(build);
  const menu = buildMenu(build, {
    open: () => navigate({ to: "/builds/$id", params: { id: build.id } }),
    remove: () => remove.mutate({ id: build.id, name }),
  });
  const cached = cachedLabel(build);
  return (
    <ContextMenu entries={menu}>
      <Row>
        <td className="max-w-0">
          <Link to="/builds/$id" params={{ id: build.id }} className={rowLink} data-row-link>
            <Tile icon="build" state={buildTileState(build)} />
            <span className="truncate font-medium text-ink">{name}</span>
          </Link>
        </td>
        <td>
          <BuildStatusLabel status={build.status} />
        </td>
        <td className="text-ink-3">{formatRelative(build.startedAtMs / 1000, now)}</td>
        <td className="text-ink-3 tabular">{cached ?? <Dash />}</td>
        <td className="text-right">
          <Duration build={build} now={now} />
        </td>
        <RowActions>
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
