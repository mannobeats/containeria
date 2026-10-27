import { type LogoKey, logoFor } from "@/lib/logos";

import { Tile } from "./tile";
import { Tip } from "./tooltip";

export type Face = { id: string; name: string; running: boolean; logo?: LogoKey | undefined };

/** Overlapping faces of the containers using something, with the name when there's one. */
export function FaceStack({
  faces,
  max = 3,
  empty = "Unused",
}: {
  faces: Face[];
  max?: number;
  empty?: string;
}) {
  if (faces.length === 0) {
    return <span className="text-ink-3">{empty}</span>;
  }
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="inline-flex shrink-0">
        {faces.slice(0, max).map((face) => (
          <Tip key={face.id} label={face.name}>
            <span className="inline-flex rounded-[7px] shadow-[0_0_0_2px_var(--bg)] [&+&]:-ml-1.5 group-hover/row:shadow-[0_0_0_2px_var(--hover)]">
              <Tile logo={face.logo ?? logoFor(face.name)} state={face.running ? "on" : "off"} />
            </span>
          </Tip>
        ))}
      </span>
      <span className="truncate text-ink-2">
        {faces.length === 1 ? faces[0]?.name : `${faces.length} containers`}
      </span>
    </span>
  );
}
