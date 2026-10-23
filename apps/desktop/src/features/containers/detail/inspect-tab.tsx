import { IconCopy } from "@tabler/icons-react";

import { copyText } from "@/lib/clipboard";
import { Button } from "@/ui/button";

import { tokenizeJson } from "./detail-model";

const tint = {
  key: "text-[light-dark(oklch(0.5_0.15_255),oklch(0.78_0.1_255))]",
  string: "text-[light-dark(oklch(0.5_0.13_150),oklch(0.8_0.12_150))]",
  number: "text-[light-dark(oklch(0.55_0.15_50),oklch(0.8_0.12_60))]",
  plain: undefined,
} as const;

/** `docker inspect`, tinted, selectable and one click from the clipboard. */
export function InspectTab({ name, raw }: { name: string; raw: string }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center border-b-[0.5px] border-line pr-3 pl-5">
        <span className="text-12 text-ink-3">The same JSON as docker inspect {name}</span>
        <Button size="sm" className="ml-auto" onClick={() => copyText("Inspect JSON", raw)}>
          <IconCopy />
          Copy JSON
        </Button>
      </div>
      <pre className="m-0 min-h-0 flex-1 overflow-auto px-5 py-3.5 font-mono text-mono-13 leading-[1.6] text-ink-2 selectable">
        {tokenizeJson(raw).map((token) => (
          <span key={token.at} className={tint[token.kind]}>
            {token.text}
          </span>
        ))}
      </pre>
    </div>
  );
}
