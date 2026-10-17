import "./styles/app.css";

import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { domMax, LazyMotion } from "motion/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { queryClient } from "./app/query-client";
import { router } from "./app/router";
import { applyAppearance } from "./lib/theme";

applyAppearance();

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <LazyMotion features={domMax} strict>
          <RouterProvider router={router} />
        </LazyMotion>
      </QueryClientProvider>
    </StrictMode>,
  );
}
