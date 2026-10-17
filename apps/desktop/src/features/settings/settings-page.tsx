import { Crumb, Page } from "@/shell/page";
import { EmptyState } from "@/ui/empty-state";
import { Tile } from "@/ui/tile";

export function SettingsPage() {
  return (
    <Page crumbs={<Crumb>Settings</Crumb>}>
      <EmptyState art={<Tile icon="settings" size="xl" />} title="Settings" className="h-full" />
    </Page>
  );
}
