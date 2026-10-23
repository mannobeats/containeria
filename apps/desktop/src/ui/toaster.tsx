import { Toaster as Sonner } from "sonner";

import { useIsDark } from "@/lib/theme";

export function Toaster() {
  const dark = useIsDark();
  return (
    <Sonner
      position="bottom-right"
      theme={dark ? "dark" : "light"}
      gap={8}
      offset={16}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex w-[340px] items-start gap-2.5 rounded-[10px] bg-[light-dark(oklch(0.99_0_0/0.9),oklch(0.29_0.005_255/0.92))] px-3 py-2.5 text-ink shadow-3 backdrop-blur-xl backdrop-saturate-180 [&_.tabler-icon]:mt-px",
          title: "text-13 font-semibold",
          description: "mt-0.5 text-12 text-ink-3",
          actionButton:
            "ml-auto h-6 shrink-0 rounded-[5px] bg-surface px-2 text-12 font-medium text-ink inset-ring-[0.5px] inset-ring-line-strong hover:bg-hover",
          success: "[&_[data-icon]]:text-ok",
          error: "[&_[data-icon]]:text-bad",
          warning: "[&_[data-icon]]:text-warn",
        },
      }}
    />
  );
}
