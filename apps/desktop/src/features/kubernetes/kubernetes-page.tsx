import { Crumb, Page } from "@/shell/page";
import { EmptyState } from "@/ui/empty-state";
import { Tile } from "@/ui/tile";

export function KubernetesPage() {
  return (
    <Page crumbs={<Crumb>Kubernetes</Crumb>}>
      <EmptyState art={<Tile icon="kube" size="xl" />} title="Kubernetes" className="h-full" />
    </Page>
  );
}
