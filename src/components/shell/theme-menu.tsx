"use client";

import { Menu } from "@base-ui/react/menu";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useState } from "react";
import {
  applyTheme,
  parseTheme,
  type ThemePreference,
} from "@/lib/ui/preferences";
import { useShell } from "./shell-context";

const OPTIONS: Array<{ id: ThemePreference; label: string; icon: typeof Sun }> =
  [
    { id: "system", label: "System", icon: Monitor },
    { id: "light", label: "Light", icon: Sun },
    { id: "dark", label: "Dark", icon: Moon },
  ];

export function ThemeMenu() {
  const shell = useShell();
  const [theme, setTheme] = useState<ThemePreference>(shell.theme);
  const Active = OPTIONS.find((option) => option.id === theme)?.icon ?? Monitor;
  return (
    <Menu.Root>
      <Menu.Trigger
        className="icon-btn topbar-theme"
        aria-label={`Theme: ${theme}`}
      >
        <Active size={17} aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="end" className="menu-positioner">
          <Menu.Popup className="menu">
            <Menu.RadioGroup
              value={theme}
              onValueChange={(value) => {
                const next = parseTheme(String(value));
                setTheme(next);
                applyTheme(next);
              }}
            >
              {OPTIONS.map((option) => (
                <Menu.RadioItem
                  key={option.id}
                  value={option.id}
                  className="menu-item"
                  closeOnClick
                >
                  <option.icon size={15} aria-hidden="true" />
                  <span>{option.label}</span>
                  <Menu.RadioItemIndicator className="menu-check">
                    <Check size={14} aria-hidden="true" />
                  </Menu.RadioItemIndicator>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
