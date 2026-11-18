import { IconCircleCheck, IconTerminal2 } from "@tabler/icons-react";

import { useCliTools, useInstallTools } from "@/features/settings/api";
import { missingTools } from "@/features/settings/model";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";

/**
 * Puts `docker` and the tools around it where every terminal finds them. A Mac that never had
 * Docker has none, and scripts that call `docker` fail as if nothing were installed.
 */
export function StepTools({ onDone }: { onDone: () => void }) {
  const { data: tools } = useCliTools();
  const install = useInstallTools();
  const missing = missingTools(tools ?? []);
  return (
    <>
      <h1 className="m-0 text-24 font-semibold tracking-[-0.016em] text-ink">
        Use docker from the terminal
      </h1>
      <p className="m-0 mt-2 mb-6 text-14 text-ink-2">
        Contena brings its own docker, Compose, kubectl and cx. Linking them into /usr/local lets
        every terminal and script find them. macOS asks for your password once, and a tool you
        already have is left alone.
      </p>
      {tools && !missing ? (
        <Banner tone="ok" icon={<IconCircleCheck aria-hidden />}>
          Your terminal has docker and the tools around it.
        </Banner>
      ) : null}
      {missing ? (
        <Banner icon={<IconTerminal2 aria-hidden />}>Not in your terminal yet: {missing}.</Banner>
      ) : null}
      <div className="mt-8 flex justify-end gap-2">
        {missing ? (
          <>
            <Button variant="ghost" size="lg" onClick={onDone}>
              Not now
            </Button>
            <Button
              variant="brand"
              size="lg"
              loading={install.isPending}
              onClick={() => install.mutate()}
            >
              Install…
            </Button>
          </>
        ) : (
          <Button variant="brand" size="lg" disabled={!tools} onClick={onDone}>
            Continue
          </Button>
        )}
      </div>
    </>
  );
}
