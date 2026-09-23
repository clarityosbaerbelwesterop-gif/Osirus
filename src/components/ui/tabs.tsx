"use client";

import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import type { ReactNode } from "react";

/** Keyboard-accessible tabs (arrow keys, Home/End) on Base UI. */
export function Tabs<T extends string>({
  value,
  onValueChange,
  items,
  label,
  children,
}: {
  value: T;
  onValueChange: (value: T) => void;
  items: Array<{ id: T; label: ReactNode }>;
  label: string;
  children?: ReactNode;
}) {
  return (
    <BaseTabs.Root
      value={value}
      onValueChange={(next) => onValueChange(next as T)}
    >
      <BaseTabs.List className="tabs-list" aria-label={label}>
        {items.map((item) => (
          <BaseTabs.Tab className="tabs-tab" key={item.id} value={item.id}>
            {item.label}
          </BaseTabs.Tab>
        ))}
      </BaseTabs.List>
      {children}
    </BaseTabs.Root>
  );
}

export const TabPanel = BaseTabs.Panel;
