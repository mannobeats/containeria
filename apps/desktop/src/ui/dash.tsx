/** The placeholder for a value that doesn't apply, such as CPU of a stopped container. */
export function Dash() {
  return (
    <>
      <span aria-hidden className="text-ink-4">
        —
      </span>
      <span className="sr-only">None</span>
    </>
  );
}
