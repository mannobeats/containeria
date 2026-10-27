import clsx from "clsx";
import { Tabs as Radix } from "radix-ui";
import type { ReactNode } from "react";

type TabItem<T extends string> = { value: T; label: string; count?: number };

type TabsProps<T extends string> = {
  tabs: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  children: ReactNode;
};

/** Underlined tabs. `children` are `TabPanel`s. */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
  children,
}: TabsProps<T>) {
  return (
    <Radix.Root
      value={value}
      onValueChange={(next) => onChange(next as T)}
      className={clsx("flex min-h-0 flex-1 flex-col", className)}
    >
      <Radix.List className="flex shrink-0 gap-0.5 border-b-[0.5px] border-line px-5">
        {tabs.map((tab) => (
          <Radix.Trigger
            key={tab.value}
            value={tab.value}
            className="relative inline-flex h-9 items-center gap-1.5 rounded-sm px-2.5 text-13 font-medium text-ink-3 transition-colors duration-140 hover:text-ink data-[state=active]:text-ink data-[state=active]:after:absolute data-[state=active]:after:inset-x-2.5 data-[state=active]:after:-bottom-px data-[state=active]:after:h-0.5 data-[state=active]:after:rounded-full data-[state=active]:after:bg-ink"
          >
            {tab.label}
            {tab.count === undefined ? null : (
              <span className="font-[450] text-ink-3 tabular">{tab.count}</span>
            )}
          </Radix.Trigger>
        ))}
      </Radix.List>
      {children}
    </Radix.Root>
  );
}

export function TabPanel({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Radix.Content value={value} className={clsx("min-h-0 flex-1 outline-none", className)}>
      {children}
    </Radix.Content>
  );
}
