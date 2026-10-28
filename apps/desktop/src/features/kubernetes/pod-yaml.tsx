import { IconCopy, IconPencil } from "@tabler/icons-react";
import { copyText } from "@/lib/clipboard";
import type { PodSummary } from "@/lib/ipc/bindings";
import { Button } from "@/ui/button";
import { CodeEditor } from "@/ui/code-editor";
import { Skeleton } from "@/ui/progress";

import { useYaml } from "./api";

export function PodYaml({ pod, onEdit }: { pod: PodSummary; onEdit: (manifest: string) => void }) {
  const { data } = useYaml("pod", pod.namespace, pod.name);
  if (data === undefined) {
    return <Skeleton className="m-5 w-72" />;
  }
  return (
    <div className="flex h-full flex-col gap-2 px-5 py-3">
      <div className="flex justify-end gap-2">
        <Button size="sm" onClick={() => copyText(`${pod.name} as YAML`, data)}>
          <IconCopy />
          Copy
        </Button>
        <Button size="sm" onClick={() => onEdit(data)}>
          <IconPencil />
          Edit and apply
        </Button>
      </div>
      <CodeEditor
        value={data}
        readOnly
        language="yaml"
        label={`${pod.name} as YAML`}
        className="flex-1"
      />
    </div>
  );
}
