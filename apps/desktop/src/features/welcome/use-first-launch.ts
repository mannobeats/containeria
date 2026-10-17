import { useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { useEngineStatus } from "@/features/engine/api";
import { usePreferences } from "@/features/settings/api";

/** Opens first launch while the engine was never created and setup wasn't finished or skipped. */
export function useFirstLaunch() {
  const { data: status } = useEngineStatus();
  const { data: preferences } = usePreferences();
  const navigate = useNavigate();
  const path = useLocation({ select: (location) => location.pathname });
  const due =
    status?.phase === "notCreated" && preferences?.onboarded === false && path !== "/welcome";
  useEffect(() => {
    if (due) {
      navigate({ to: "/welcome" }).catch(() => undefined);
    }
  }, [due, navigate]);
}
