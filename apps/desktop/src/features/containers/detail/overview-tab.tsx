import type { ContainerDetails } from "@/lib/ipc/bindings";

import { useStatsHistory } from "./api";
import { EnvSection } from "./env-section";
import { CrashBanner, DetailsSection, MountsSection, PortsSection } from "./overview-sections";
import { OverviewSide } from "./overview-side";

export function OverviewTab({ details }: { details: ContainerDetails }) {
  const history = useStatsHistory(details.id, details.state === "running");
  return (
    <div className="grid max-w-[1240px] grid-cols-[minmax(0,1fr)_300px] gap-8 px-5 pt-[18px] pb-12 max-[1180px]:grid-cols-1">
      <div className="flex min-w-0 flex-col gap-6">
        <CrashBanner details={details} />
        <DetailsSection details={details} />
        <PortsSection details={details} />
        <MountsSection details={details} />
        <EnvSection env={details.env} />
      </div>
      <OverviewSide details={details} history={history} />
    </div>
  );
}
