import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  type StaticDataRouteOption,
} from "@tanstack/react-router";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { cleanup, render } from "@testing-library/react";
import { domMax, LazyMotion } from "motion/react";
import type { ReactNode } from "react";
import { afterEach } from "vitest";

import type { commands } from "@/lib/ipc/bindings";
import { TooltipProvider } from "@/ui/tooltip";

type Commands = typeof commands;
type CommandName = keyof Commands;

/** One answer per command, typed by what the Rust command really returns. */
type Handlers = {
  [Name in CommandName]?: (args: Record<string, unknown>) => Awaited<ReturnType<Commands[Name]>>;
};

/** A recorded IPC call: the command as named in `bindings.ts`, and its arguments. */
export type Call = { command: CommandName; args: Record<string, unknown> };

const toCamel = (snake: string) =>
  snake.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

// Unmount first: components unlisten from mocked events while unmounting.
afterEach(() => {
  cleanup();
  clearMocks();
});

/**
 * Answers Tauri commands and records every call. Commands without a handler resolve to `null`, like
 * a Rust command returning `()`.
 */
export function mockCommands(handlers: Handlers): Call[] {
  const calls: Call[] = [];
  mockIPC(
    (command, payload) => {
      const name = toCamel(command) as CommandName;
      const args = (payload ?? {}) as Record<string, unknown>;
      calls.push({ command: name, args });
      return handlers[name]?.(args) ?? null;
    },
    { shouldMockEvents: true },
  );
  return calls;
}

type RenderOptions = {
  /** Rendered as the root route, with `ui` as the page inside its `<Outlet />`. */
  shell?: () => ReactNode;
  staticData?: StaticDataRouteOption;
  /**
   * Mounts `ui` at the app's route pattern, such as `/kubernetes/pods/$namespace/$name`, so pages
   * that read params or search through `getRouteApi` work. Other paths still render a blank page.
   */
  route?: string;
  /** The URL to open, such as `/kubernetes/pods/shop/web?tab=logs`. */
  url?: string;
};

/** Renders `ui` inside the app's providers and a router that accepts any path. */
export function renderWithApp(
  ui: ReactNode,
  { shell, staticData = {}, route = "$", url = "/test" }: RenderOptions = {},
) {
  const root = createRootRoute(shell ? { component: shell } : {});
  const page = createRoute({
    getParentRoute: () => root,
    path: route,
    staticData,
    component: () => ui,
  });
  const other = createRoute({ getParentRoute: () => root, path: "$", component: () => null });
  const router = createRouter({
    routeTree: root.addChildren(route === "$" ? [page] : [page, other]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={client}>
      <LazyMotion features={domMax} strict>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </LazyMotion>
    </QueryClientProvider>,
  );
  return { ...result, client, router };
}
