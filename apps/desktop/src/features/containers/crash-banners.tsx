import { IconAlertCircle } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";

import type { ContainerSummary } from "@/lib/ipc/bindings";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";

import { exitCode, isCrashed } from "./model";

/** One red banner per container that exited with an error, with the way to find out why. */
export function CrashBanners({ containers }: { containers: ContainerSummary[] }) {
  return containers.filter(isCrashed).map((container) => (
    <Banner
      key={container.id}
      tone="bad"
      icon={<IconAlertCircle aria-hidden />}
      className="mx-5 mb-3"
      action={
        <Link
          to="/containers/$id"
          params={{ id: container.id }}
          search={{ tab: "logs" }}
          className="no-underline"
        >
          <Button size="sm" tabIndex={-1}>
            View logs
          </Button>
        </Link>
      }
    >
      <b>{container.name}</b> exited with code {exitCode(container) ?? "unknown"}.{" "}
      {container.status.replace(/^Exited \(\d+\) /, "")}.
    </Banner>
  ));
}
