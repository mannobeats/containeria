import { Tooltip as Radix } from "radix-ui";
import type { ReactElement, ReactNode } from "react";

import { Kbd } from "./kbd";

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <Radix.Provider delayDuration={450} skipDelayDuration={200}>
      {children}
    </Radix.Provider>
  );
}

type TipProps = {
  label: ReactNode;
  kbd?: string;
  side?: "top" | "bottom" | "left" | "right";
  children: ReactElement;
};

export function Tip({ label, kbd, side = "bottom", children }: TipProps) {
  return (
    <Radix.Root>
      <Radix.Trigger asChild>{children}</Radix.Trigger>
      <Radix.Portal>
        <Radix.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className="z-50 flex max-w-[280px] items-center gap-1.5 rounded-sm bg-[light-dark(oklch(0.99_0_0/0.92),oklch(0.32_0.005_255/0.94))] px-2 py-[5px] text-12 leading-[1.35] text-ink shadow-2 backdrop-blur-xl backdrop-saturate-180 data-[state=delayed-open]:animate-fade"
        >
          {label}
          {kbd ? <Kbd>{kbd}</Kbd> : null}
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}
