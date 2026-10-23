import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { useImages } from "@/features/images/api";
import type { BuildDetail, EnvVar } from "@/lib/ipc/bindings";
import { Kv, type KvRow } from "@/ui/kv";

const mono = (value: string) => <code className="font-mono text-mono-12 select-text">{value}</code>;

function Pairs({ pairs }: { pairs: EnvVar[] }) {
  return (
    <span className="flex flex-col gap-0.5">
      {pairs.map((pair) => (
        <code key={pair.key} className="font-mono text-mono-12 select-text">
          {pair.key}={pair.value}
        </code>
      ))}
    </span>
  );
}

/** The image the build made, linked while it is still on the engine. */
function Image({ id }: { id: string }) {
  const { data: images } = useImages();
  const image = images?.find((candidate) => candidate.id === id);
  if (!image) {
    return <span className="text-ink-3">No longer on this engine</span>;
  }
  return (
    <Link to="/images/$id" params={{ id }} className="font-mono text-mono-12 text-brand-ink">
      {image.references[0] ?? id.slice(7, 19)}
    </Link>
  );
}

function rows(detail: BuildDetail): KvRow[] {
  const all: { label: string; value: ReactNode }[] = [
    { label: "Image", value: detail.imageId ? <Image id={detail.imageId} /> : null },
    { label: "Dockerfile", value: detail.dockerfile && mono(detail.dockerfile) },
    { label: "Context", value: detail.context && mono(detail.context) },
    { label: "Target", value: detail.target && mono(detail.target) },
    {
      label: "Platform",
      value: detail.platforms.length > 0 && mono(detail.platforms.join(", ")),
    },
    { label: "Repository", value: detail.vcsRepository && mono(detail.vcsRepository) },
    { label: "Revision", value: detail.vcsRevision && mono(detail.vcsRevision) },
    {
      label: "Build arguments",
      value: detail.buildArgs.length > 0 && <Pairs pairs={detail.buildArgs} />,
    },
    { label: "Labels", value: detail.labels.length > 0 && <Pairs pairs={detail.labels} /> },
    { label: "Build ID", value: mono(detail.id) },
  ];
  return all.filter((row) => Boolean(row.value));
}

/** What the build was asked to do and what it made. */
export function BuildInfo({ detail }: { detail: BuildDetail }) {
  return <Kv rows={rows(detail)} className="max-w-[880px] px-5 py-4" />;
}
