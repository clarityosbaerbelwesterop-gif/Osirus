"use client";

import {
  Brain,
  Building2,
  Cpu,
  Gauge,
  Palette,
  Plug,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  User,
  type LucideIcon,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";

const SECTIONS: Array<{ href: string; label: string; icon: LucideIcon }> = [
  { href: "/app/settings", label: "Konto", icon: User },
  {
    href: "/app/settings/workspace",
    label: "Arbeitsbereich",
    icon: Building2,
  },
  { href: "/app/settings/connections", label: "Verbindungen", icon: Plug },
  { href: "/app/settings/models", label: "Modelle", icon: Cpu },
  { href: "/app/settings/memory", label: "Gedächtnis", icon: Brain },
  {
    href: "/app/settings/agent",
    label: "Agentenverhalten",
    icon: SlidersHorizontal,
  },
  { href: "/app/settings/security", label: "Sicherheit", icon: Shield },
  { href: "/app/settings/privacy", label: "Datenschutz", icon: ShieldCheck },
  { href: "/app/settings/usage", label: "Verbrauch", icon: Gauge },
  { href: "/app/settings/appearance", label: "Darstellung", icon: Palette },
];

export function SettingsNav() {
  const pathname = usePathname() ?? "";
  return (
    <nav className="settings-nav" aria-label="Bereiche der Einstellungen">
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
