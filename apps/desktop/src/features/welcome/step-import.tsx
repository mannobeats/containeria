import { MigrationView } from "./migration-view";

/** Brings images, volumes and containers over from another engine on the Mac. */
export function StepImport({ onDone }: { onDone: () => void }) {
  return (
    <>
      <h1 className="m-0 text-24 font-semibold tracking-[-0.016em] text-ink">
        Bring your work over
      </h1>
      <p className="m-0 mt-2 mb-6 text-14 text-ink-2">
        Images, volumes with their data, and containers with their ports, settings and Compose
        projects. Pick what to copy.
      </p>
      <MigrationView onDone={onDone} />
    </>
  );
}
