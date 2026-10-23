/** `/a/b/c` → `/`, `/a`, `/a/b`, `/a/b/c`: the steps of a folder breadcrumb. */
export function pathSteps(path: string): { label: string; path: string }[] {
  const parts = path.split("/").filter(Boolean);
  return [
    { label: "/", path: "/" },
    ...parts.map((part, index) => ({
      label: part,
      path: `/${parts.slice(0, index + 1).join("/")}`,
    })),
  ];
}

/** The path of `name` inside `directory`, without doubling the root slash. */
export function childPath(directory: string, name: string): string {
  return directory === "/" ? `/${name}` : `${directory}/${name}`;
}
