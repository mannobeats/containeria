import { IconAlertCircle } from "@tabler/icons-react";
import { getRouteApi, useNavigate } from "@tanstack/react-router";

import { errorMessage, isCommandError } from "@/lib/ipc/errors";
import { Crumb, Page } from "@/shell/page";
import { Banner } from "@/ui/banner";

import { useCluster, useKubernetesEnabled } from "./api";
import { ClusterView } from "./cluster-view";
import { KubernetesOff, KubernetesStarting } from "./kubernetes-off";
import { asTab } from "./model";

const route = getRouteApi("/kubernetes");

function Body() {
  const enabled = useKubernetesEnabled();
  const cluster = useCluster();
  const { tab } = route.useSearch();
  const navigate = useNavigate();
  if (enabled === false) {
    return <KubernetesOff />;
  }
  if (cluster.data) {
    return (
      <ClusterView
        cluster={cluster.data}
        tab={asTab(tab)}
        onTab={(next) => navigate({ to: "/kubernetes", search: { tab: next } })}
      />
    );
  }
  if (
    cluster.error &&
    !(isCommandError(cluster.error) && cluster.error.kind === "kubernetesUnavailable")
  ) {
    return (
      <Banner tone="bad" icon={<IconAlertCircle aria-hidden />} className="m-5">
        {errorMessage(cluster.error)}
      </Banner>
    );
  }
  return <KubernetesStarting canTurnOff />;
}

export function KubernetesPage() {
  return (
    <Page crumbs={<Crumb>Kubernetes</Crumb>}>
      <Body />
    </Page>
  );
}
