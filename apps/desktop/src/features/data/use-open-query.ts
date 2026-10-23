import { useNavigate } from "@tanstack/react-router";

import { nextQueryTab, useWorkspace } from "./workspace-store";

/** Opens SQL in a new query tab of a connection's workspace. */
export function useOpenQuery() {
  const navigate = useNavigate();
  return (connection: string, sql: string) => {
    const state = useWorkspace.getState();
    const tab = nextQueryTab(state.tabs[connection] ?? []);
    state.openTab(connection, tab);
    state.setSql(`${connection}|${tab.key}`, sql);
    navigate({ to: "/data/$connection", params: { connection }, search: { tab: tab.key } }).catch(
      () => undefined,
    );
  };
}
