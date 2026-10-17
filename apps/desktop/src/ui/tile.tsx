import clsx from "clsx";

import { type LogoKey, logoTitle, logoUrl } from "@/lib/logos";
import { useIsDark } from "@/lib/theme";

import { CxIcon, type CxIconName } from "./cx-icon";

const sizes = {
  sm: "size-5 rounded-[5px] [&>svg]:size-3.5",
  md: "size-6 rounded-sm [&>svg]:size-4",
  lg: "size-9 rounded-[9px] [&>svg]:size-[22px]",
  xl: "size-[52px] rounded-lg shadow-[inset_0_0_0_0.5px_light-dark(oklch(0_0_0/0.12),oklch(1_0_0/0.1)),0_2px_6px_light-dark(oklch(0_0_0/0.08),oklch(0_0_0/0.35))] [&>svg]:size-[30px]",
} as const;

type TileProps = {
  logo?: LogoKey | undefined;
  icon?: CxIconName;
  size?: keyof typeof sizes;
  state?: "on" | "off" | "bad";
  className?: string;
};

/**
 * A neutral chip carrying a real brand logo, or Containeria's own icon when there is none. It is
 * decorative: the name beside it is what screen readers announce.
 */
export function Tile({
  logo,
  icon = "container",
  size = "md",
  state = "on",
  className,
}: TileProps) {
  const dark = useIsDark();
  return (
    <span
      className={clsx(
        "grid shrink-0 place-items-center overflow-hidden bg-[light-dark(oklch(1_0_0),oklch(0.3_0.006_255))] text-ink-2 shadow-[inset_0_0_0_0.5px_light-dark(oklch(0_0_0/0.12),oklch(1_0_0/0.1)),0_1px_1.5px_light-dark(oklch(0_0_0/0.06),oklch(0_0_0/0.3))] transition-[filter,opacity] duration-220",
        sizes[size],
        state === "off" && "opacity-50 grayscale",
        state === "bad" &&
          "shadow-[inset_0_0_0_1.5px_var(--bad),0_0_0_3px_light-dark(oklch(0.6_0.2_27/0.14),oklch(0.6_0.2_27/0.22))]",
        className,
      )}
    >
      {logo ? (
        <img
          src={logoUrl(logo, dark)}
          alt=""
          title={logoTitle(logo)}
          draggable={false}
          className="block size-[70%] object-contain"
        />
      ) : (
        <CxIcon name={icon} accent={size === "xl"} />
      )}
    </span>
  );
}
