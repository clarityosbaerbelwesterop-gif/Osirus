"use client";

import {
  Brain,
  Building2,
  Cpu,
  Gauge,
  Palette,
  Plug,
  Shield,
  SlidersHorizontal,
  User,
  type LucideIcon,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";

const SECTIONS: Array<{ href: string; label: string; icon: LucideIcon }> = [
  { href: "/app/settings", label: "Account", icon: User },
  { href: "/app/settings/workspace", label: "Workspace", icon: Building2 },
  { href: "/app/settings/connections", label: "Connections", icon: Plug },
  { href: "/app/settings/models", label: "Models", icon: Cpu },
  { href: "/app/settings/memory", label: "Memory", icon: Brain },
  {
    href: "/app/settings/agent",
    label: "Agent behavior",
    icon: SlidersHorizontal,
  },
  { href: "/app/settings/security", label: "Security", icon: Shield },
  { href: "/app/settings/usage", label: "Usage", icon: Gauge },
  { href: "/app/settings/appearance", label: "Appearance", icon: Palette },
];

export function SettingsNav() {
  const pathname = usePathname() ?? "";
  return (
    <nav className="settings-nav" aria-label="Settings sections">
      {SECTIONS.map((section) => {
        const active = pathname === section.href;
        return (
          <Link
            key={section.href}
            href={section.href as Route}
            aria-current={active ? "page" : undefined}
          >
            <section.icon size={16} aria-hidden="true" />
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}
