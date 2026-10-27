import "../styles/app.css";

import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { queryClient } from "@/app/query-client";
import { SettingsWindow } from "@/features/settings/settings-window";
import { behaveNatively } from "@/lib/native-behavior";
import { applyAppearance, followAppearance } from "@/lib/theme";
import { TooltipProvider } from "@/ui/tooltip";

applyAppearance();
behaveNatively();
followAppearance();

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <SettingsWindow />
        </TooltipProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}
