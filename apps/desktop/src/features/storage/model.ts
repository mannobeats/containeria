import type { DiskUsage } from "@/lib/ipc/bindings";

/**
 * How far the disk files on the Mac may run ahead of Docker's own data before offering a trim. The
 * Linux system, logs and Kubernetes take 2–3 GB Docker doesn't count, and the guest trims itself
 * weekly, so a gap under 5 GB is mostly noise. Past it, gigabytes are free inside the engine but
 * still held on the Mac, as after deleting images or volumes without Containeria.
 */
const TRIM_GAP_BYTES = 5_000_000_000;

/** Docker's own total across images, containers, volumes and the build cache. */
export function dockerBytes(usage: DiskUsage): number {
  return (
    usage.images.sizeBytes +
    usage.containers.sizeBytes +
    usage.volumes.sizeBytes +
    usage.buildCache.sizeBytes
  );
}

/** Whether the engine's disk holds enough free space for "Return Free Space to the Mac". */
export function offersTrim(diskBytes: number, docker: number): boolean {
  return diskBytes - docker > TRIM_GAP_BYTES;
}
