import { useId } from "react";

/** Containeria's mark: three containers stacked on the macOS accent. */
export function AppMark({ size = 28 }: { size?: number }) {
  const gradient = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="shrink-0">
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="oklch(0.70 0.16 255)" />
          <stop offset="1" stopColor="oklch(0.52 0.20 262)" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill={`url(#${gradient})`} />
      <rect x="7" y="7.5" width="18" height="4.6" rx="2.3" fill="white" opacity=".55" />
      <rect x="7" y="13.7" width="18" height="4.6" rx="2.3" fill="white" opacity=".78" />
      <rect x="7" y="19.9" width="18" height="4.6" rx="2.3" fill="white" />
    </svg>
  );
}
