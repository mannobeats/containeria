import { IconTerminal2 } from "@tabler/icons-react";

import { useCliTools, useInstallTools } from "@/features/settings/api";
import { missingTools } from "@/features/settings/model";
import { useUi } from "@/shell/ui-store";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";

/**
 * Says when no terminal finds `docker`, and offers to install it. Without it the engine runs
 * and every script that calls `docker` still fails. Stays away once it is turned down.
 */
export function ToolsBanner() {
  const { data: tools } = useCliTools();
  const install = useInstallTools();
  const declined = useUi((state) => state.toolsDeclined);
  const decline = useUi((state) => state.declineTools);
  const missing = missingTools(tools ?? []);
  if (!missing || declined) {
    return null;
  }
  return (
    <Banner
      tone="brand"
      icon={<IconTerminal2 aria-hidden />}
      className="mx-5 mb-3"
      action={
        <>
          <Button variant="ghost" size="sm" onClick={decline}>
            Not now
          </Button>
          <Button size="sm" loading={install.isPending} onClick={() => install.mutate()}>
            Install…
          </Button>
        </>
      }
    >
      <b>Your terminal doesn't have {missing} yet.</b> Contena brings them; installing links them
      into /usr/local.
    </Banner>
  );
}
