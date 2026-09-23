"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useState } from "react";
import { applyTheme, type ThemePreference } from "@/lib/ui/preferences";
import { useShell } from "../shell/shell-context";

const OPTIONS = [
  { id: "system", label: "System", icon: Monitor },
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
] as const;

export function AppearanceSettings() {
  const shell = useShell();
  const [theme, setTheme] = useState<ThemePreference>(shell.theme);
  return (
    <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="field-label">Theme</legend>
      <div className="segmented" role="radiogroup" aria-label="Theme">
        {OPTIONS.map((option) => (
          <label key={option.id}>
            <input
              type="radio"
              name="theme"
              value={option.id}
              checked={theme === option.id}
              onChange={() => {
                setTheme(option.id);
                applyTheme(option.id);
              }}
            />
            <option.icon size={14} aria-hidden="true" />
            {option.label}
          </label>
        ))}
      </div>
      <p className="field-hint">
        System follows your device. Motion follows your device&apos;s reduced
        motion setting.
      </p>
    </fieldset>
  );
}
