import { useNavigate } from "@tanstack/react-router";

import { type Tab, useWorkspace } from "./workspace-store";

/** Rebuilds a tab from the key in the URL, so a link to any tab opens it. */
export function tabFromKey(key: string): Tab | undefined {
  const [kind, ...rest] = key.split(":");
  const name = rest.join(":");
  switch (kind) {
    case "table":
      return name ? { key, kind: "table", title: name.split(".").at(-1) ?? name } : undefined;
    case "query":
      return name ? { key, kind: "query", title: `Query ${name}` } : undefined;
    case "diagram":
      return { key, kind: "diagram", title: "Schema diagram" };
    case "history":
      return { key, kind: "history", title: "History" };
    case "keys":
      return { key, kind: "keys", title: "Keys" };
    default:
      return undefined;
  }
}

export function tableTab(tableKey: string): Tab {
  return { key: `table:${tableKey}`, kind: "table", title: tableKey.split(".").at(-1) ?? tableKey };
}

/** Opens a tab in the workspace and shows it. */
export function useOpenTab(connection: string) {
  const navigate = useNavigate();
  const openTab = useWorkspace((state) => state.openTab);
  return (tab: Tab) => {
    openTab(connection, tab);
    navigate({ to: "/data/$connection", params: { connection }, search: { tab: tab.key } }).catch(
      () => undefined,
    );
  };
}
