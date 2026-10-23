import "../styles/app.css";

import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { queryClient } from "@/app/query-client";
import { behaveNatively } from "@/lib/native-behavior";
import { applyAppearance, followAppearance } from "@/lib/theme";
import { TooltipProvider } from "@/ui/tooltip";

import { TrayView } from "./tray-view";

applyAppearance();
behaveNatively();
followAppearance();

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <TrayView />
        </TooltipProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}
