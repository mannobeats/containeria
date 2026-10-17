import { getRouteApi, Link } from "@tanstack/react-router";

import { useContainers } from "@/features/containers/api";
import { formatBytes } from "@/lib/format";
import type { ImageDetail, ImageLayer } from "@/lib/ipc/bindings";
import { logoFor } from "@/lib/logos";
import { Crumb, Page } from "@/shell/page";
import { ParentCrumb } from "@/shell/parent-crumb";
import { Chip } from "@/ui/chip";
import { EmptyState } from "@/ui/empty-state";
import { Kv } from "@/ui/kv";
import { Skeleton } from "@/ui/progress";
import { ResourceHeader } from "@/ui/resource-header";
import { Tile } from "@/ui/tile";

import { useImage, useImages } from "./api";
import { shortId, usersOf } from "./model";

const route = getRouteApi("/images/$id");

function Layers({ layers }: { layers: ImageLayer[] }) {
  const largest = Math.max(...layers.map((layer) => layer.sizeBytes), 1);
  return (
    <section className="min-w-0">
      <h2 className="m-0 mb-2 flex items-baseline gap-2 text-13 font-semibold text-ink">
        Layers <span className="text-12 font-normal text-ink-3">{layers.length}</span>
      </h2>
      <ol className="m-0 list-none border-t-[0.5px] border-line p-0">
        {layers.map((layer) => (
          <li
            key={layer.step}
            className="grid h-[34px] grid-cols-[22px_minmax(0,1fr)_80px_72px] items-center gap-3 border-b-[0.5px] border-line hover:bg-hover"
          >
            <span className="text-right text-12 text-ink-4 tabular">{layer.step}</span>
            <code
              className="truncate font-mono text-mono-12 text-ink-2 select-text"
              title={layer.createdBy}
            >
              {layer.createdBy}
            </code>
            <span aria-hidden className="h-1 overflow-hidden rounded-[2px] bg-fill">
              <i
                className="block h-full origin-left bg-s1"
                style={{ transform: `scaleX(${layer.sizeBytes / largest})` }}
              />
            </span>
            <span className="text-right text-12 text-ink-3 tabular">
              {formatBytes(layer.sizeBytes)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

const code = (values: string[]) =>
  values.length === 0 ? (
    <span className="text-ink-3">None</span>
  ) : (
    <code className="font-mono text-mono-12">{values.join(" ")}</code>
  );

function Config({ image }: { image: ImageDetail }) {
  return (
    <Kv
      rows={[
        { label: "Entrypoint", value: code(image.entrypoint) },
        { label: "Command", value: code(image.command) },
        { label: "Working dir", value: code(image.workingDir ? [image.workingDir] : []) },
        { label: "User", value: image.user || "root" },
        {
          label: "Exposed ports",
          value: image.exposedPorts.length
            ? image.exposedPorts.map((port) => (
                <Chip key={port} mono>
                  {port}
                </Chip>
              ))
            : code([]),
        },
        {
          label: "Environment",
          value: (
            <span className="flex flex-col gap-0.5">
              {image.env.map((line) => (
                <code key={line} className="font-mono text-mono-12">
                  {line}
                </code>
              ))}
            </span>
          ),
        },
      ]}
    />
  );
}

function UsedBy({ id }: { id: string }) {
  const { data: images } = useImages();
  const { data: containers } = useContainers();
  const image = images?.find((candidate) => candidate.id === id);
  const users = image ? usersOf(image, containers ?? []) : [];
  if (users.length === 0) {
    return <p className="m-0 text-13 text-ink-3">No container uses this image.</p>;
  }
  return (
    <ul className="m-0 list-none border-t-[0.5px] border-line p-0">
      {users.map((user) => (
        <li key={user.id}>
          <Link
            to="/containers/$id"
            params={{ id: user.id }}
            className="flex h-[34px] items-center gap-2.5 border-b-[0.5px] border-line px-0.5 text-13 text-ink no-underline hover:bg-hover"
          >
            <Tile logo={logoFor(user.image)} state={user.state === "running" ? "on" : "off"} />
            <span className="flex-1 truncate">{user.name}</span>
            <span className="text-12 text-ink-3">{user.status}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function ImagePage() {
  const { id } = route.useParams();
  const { data: image, isError } = useImage(id);
  const name = image?.references[0] ?? shortId(id);
  const crumbs = (
    <>
      <ParentCrumb to="/images" label="Images" />
      <Crumb>{name}</Crumb>
    </>
  );
  if (isError) {
    return (
      <Page crumbs={crumbs}>
        <EmptyState
          art={<Tile icon="image" size="xl" />}
          title={`${name} isn't on this engine`}
          className="h-full"
        >
          It may have been deleted. Pull it again to use it.
        </EmptyState>
      </Page>
    );
  }
  return (
    <Page crumbs={crumbs}>
      <ResourceHeader
        face={<Tile logo={logoFor(name)} icon="image" size="lg" />}
        title={image?.references.length ? name : "Dangling build layer"}
        meta={
          image ? (
            <>
              <span className="font-mono text-mono-12">{shortId(image.id)}</span>
              <span>{image.platform}</span>
            </>
          ) : (
            <Skeleton className="w-48" />
          )
        }
      />
      {image ? (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(300px,380px)] items-start gap-8 px-5 pt-1.5 pb-10 max-[1180px]:grid-cols-1">
          <Layers layers={image.layers} />
          <aside className="flex flex-col gap-6">
            <section>
              <h2 className="m-0 mb-2 text-13 font-semibold text-ink">Used by</h2>
              <UsedBy id={id} />
            </section>
            <section>
              <h2 className="m-0 mb-2 text-13 font-semibold text-ink">Config</h2>
              <Config image={image} />
            </section>
          </aside>
        </div>
      ) : null}
    </Page>
  );
}
