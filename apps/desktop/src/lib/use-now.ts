import { useEffect, useState } from "react";

/** The time, ticking every `everyMs` while `active`, for clocks such as a running build's. */
export function useNow(active: boolean, everyMs = 1000): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [active, everyMs]);
  return now;
}
