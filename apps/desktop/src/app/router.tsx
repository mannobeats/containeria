import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from "@tanstack/react-router";

import { AppShell } from "@/shell/app-shell";
import { NotFound } from "@/shell/not-found";

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
  interface StaticDataRouteOption {
    /** The view lists what runs in the engine, so it waits for the engine to run. */
    needsEngine?: boolean;
    /** Full-window views without the sidebar, like first launch. */
    bare?: boolean;
    title?: string;
  }
}

type TabSearch = { tab?: string };

const tabSearch = (search: Record<string, unknown>): TabSearch =>
  typeof search.tab === "string" ? { tab: search.tab } : {};

const root = createRootRoute({ component: AppShell, notFoundComponent: NotFound });

const index = createRoute({
  getParentRoute: () => root,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/containers" });
  },
});

type PageModule = Promise<{ default: () => React.JSX.Element }>;

function page<const Path extends string>(
  path: Path,
  title: string,
  load: () => PageModule,
  needsEngine = true,
) {
  return createRoute({
    getParentRoute: () => root,
    path,
    staticData: { needsEngine, title },
    component: lazyRouteComponent(load),
  });
}

const containers = page("containers", "Containers", () =>
  import("@/features/containers/containers-page").then((module) => ({
    default: module.ContainersPage,
  })),
);

const containerDetail = createRoute({
  getParentRoute: () => root,
  path: "containers/$id",
  staticData: { needsEngine: true, title: "Container" },
  validateSearch: tabSearch,
  component: lazyRouteComponent(
    () => import("@/features/containers/container-page"),
    "ContainerPage",
  ),
});

const routeTree = root.addChildren([
  index,
  containers,
  containerDetail,
  page("images", "Images", () =>
    import("@/features/images/images-page").then((module) => ({ default: module.ImagesPage })),
  ),
  page("volumes", "Volumes", () =>
    import("@/features/volumes/volumes-page").then((module) => ({ default: module.VolumesPage })),
  ),
  page("networks", "Networks", () =>
    import("@/features/networks/networks-page").then((module) => ({
      default: module.NetworksPage,
    })),
  ),
  page("images/$id", "Image", () =>
    import("@/features/images/image-page").then((module) => ({ default: module.ImagePage })),
  ),
  page("volumes/$name", "Volume", () =>
    import("@/features/volumes/volume-page").then((module) => ({ default: module.VolumePage })),
  ),
  page("networks/$id", "Network", () =>
    import("@/features/networks/network-page").then((module) => ({ default: module.NetworkPage })),
  ),
  page("kubernetes", "Kubernetes", () =>
    import("@/features/kubernetes/kubernetes-page").then((module) => ({
      default: module.KubernetesPage,
    })),
  ),
  page(
    "machines",
    "Linux machines",
    () =>
      import("@/features/machines/machines-page").then((module) => ({
        default: module.MachinesPage,
      })),
    false,
  ),
  page(
    "data",
    "Data",
    () => import("@/features/data/data-page").then((module) => ({ default: module.DataPage })),
    false,
  ),
  page("domains", "Domains", () =>
    import("@/features/domains/domains-page").then((module) => ({ default: module.DomainsPage })),
  ),
  page(
    "activity",
    "Activity",
    () =>
      import("@/features/activity/activity-page").then((module) => ({
        default: module.ActivityPage,
      })),
    false,
  ),
  page(
    "settings",
    "Settings",
    () =>
      import("@/features/settings/settings-page").then((module) => ({
        default: module.SettingsPage,
      })),
    false,
  ),
]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  scrollRestoration: true,
});
