import { IconCopy, IconExternalLink, IconFolder } from "@tabler/icons-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { ReactNode } from "react";

import { copyText } from "@/lib/clipboard";
import { formatDateTime } from "@/lib/clock";
import type { ContainerDetails } from "@/lib/ipc/bindings";
import { Banner } from "@/ui/banner";
import { CxIcon } from "@/ui/cx-icon";
import { IconAction } from "@/ui/icon-action";
import { Kv } from "@/ui/kv";
import { ContextMenu } from "@/ui/menu";

import { miniTable } from "./mini-table";

const when = (timestamp: string | null) =>
  timestamp ? formatDateTime(Date.parse(timestamp)) : "—";

export function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="m-0 text-13 font-semibold text-ink">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function CrashBanner({ details }: { details: ContainerDetails }) {
  if (details.state !== "exited" || details.exitCode === 0) {
    return null;
  }
  return (
    <Banner tone="bad">
      <b>Exited with code {details.exitCode}</b>
      {details.restartCount > 0 ? ` after ${details.restartCount} restarts` : ""}.{" "}
      {details.error ? (
        <span className="font-mono text-mono-12">{details.error}</span>
      ) : (
        "The logs say why."
      )}
    </Banner>
  );
}

export function DetailsSection({ details }: { details: ContainerDetails }) {
  const running = details.state === "running";
  return (
    <Section title="Details">
      <Kv
        rows={[
          {
            label: "Image",
            value: <span className="font-mono text-mono-13">{details.image}</span>,
          },
          {
            label: "Command",
            value: (
              <span className="font-mono text-mono-13 selectable">{details.command || "—"}</span>
            ),
          },
          {
            label: "Container ID",
            value: (
              <>
                <span className="font-mono text-mono-13 text-ink-3">{details.id.slice(0, 12)}</span>
                <IconAction label="Copy ID" onClick={() => copyText("ID", details.id)}>
                  <IconCopy />
                </IconAction>
              </>
            ),
          },
          { label: "Created", value: when(details.createdAt) },
          {
            label: running ? "Started" : "Finished",
            value: when(running ? details.startedAt : details.finishedAt),
          },
          {
            label: "Restart policy",
            value: `${details.restartPolicy}${details.restartCount > 0 ? ` · ${details.restartCount} restarts` : ""}`,
          },
          { label: "Platform", value: details.platform },
          {
            label: "IP address",
            value: <span className="font-mono text-mono-13">{details.ipAddress ?? "—"}</span>,
          },
          { label: "Networks", value: details.networks.join(", ") || "—" },
        ]}
      />
    </Section>
  );
}

export function PortsSection({ details }: { details: ContainerDetails }) {
  const published = details.ports.filter((port) => port.host !== null);
  return (
    <Section title="Ports">
      {published.length === 0 ? (
        <p className="m-0 text-12 text-ink-3">No published ports.</p>
      ) : (
        <table className={miniTable}>
          <thead>
            <tr>
              <th>Mac</th>
              <th>Container</th>
              <th>Protocol</th>
              <th>
                <span className="sr-only">Open</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {published.map((port) => {
              const url = `http://localhost:${port.host}`;
              const open = () => openUrl(url).catch(() => undefined);
              return (
                <ContextMenu
                  key={`${port.host}-${port.container}-${port.protocol}`}
                  entries={[
                    { label: "Open in browser", onSelect: open },
                    { kind: "separator" },
                    { label: "Copy URL", onSelect: () => copyText("URL", url) },
                  ]}
                >
                  <tr>
                    <td className="font-mono text-mono-13">localhost:{port.host}</td>
                    <td className="font-mono text-mono-13">{port.container}</td>
                    <td className="uppercase">{port.protocol}</td>
                    <td className="text-right">
                      <IconAction label={`Open localhost:${port.host}`} onClick={open}>
                        <IconExternalLink />
                      </IconAction>
                    </td>
                  </tr>
                </ContextMenu>
              );
            })}
          </tbody>
        </table>
      )}
    </Section>
  );
}

export function MountsSection({ details }: { details: ContainerDetails }) {
  return (
    <Section title="Mounts">
      {details.mounts.length === 0 ? (
        <p className="m-0 text-12 text-ink-3">
          No mounts. Files written here live in the container's writable layer.
        </p>
      ) : (
        <table className={miniTable}>
          <thead>
            <tr>
              <th>Source</th>
              <th>Destination</th>
              <th>Mode</th>
            </tr>
          </thead>
          <tbody>
            {details.mounts.map((mount) => (
              <tr key={mount.destination}>
                <td className="max-w-0">
                  <span className="flex min-w-0 items-center gap-2 text-ink-3">
                    {mount.kind === "volume" ? (
                      <CxIcon name="volume" />
                    ) : (
                      <IconFolder aria-hidden />
                    )}
                    <span className="truncate font-mono text-mono-12 text-ink">
                      {mount.source || mount.kind}
                    </span>
                  </span>
                </td>
                <td className="font-mono text-mono-12">{mount.destination}</td>
                <td>{mount.readOnly ? "Read only" : "Read and write"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}
