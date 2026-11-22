import Link from "next/link";

export const SITE_FOOTER_LINKS = [
  { href: "/ueber-uns", label: "Über uns" },
  { href: "/osirus-ki", label: "Osirus KI" },
  { href: "/ki-team-freigabe", label: "KI-Team mit Freigabe" },
  { href: "/legal/impressum", label: "Impressum" },
  { href: "/legal/privacy", label: "Datenschutz" },
  { href: "/legal/terms", label: "AGB" },
  { href: "/legal/eula", label: "EULA" },
  { href: "/legal/cookies", label: "Cookies" },
  { href: "/sicherheit", label: "Sicherheit" },
  { href: "/kuendigen", label: "Verträge hier kündigen" },
] as const;

export function SiteFooterLinks() {
  return (
    <>
      {SITE_FOOTER_LINKS.map((item) => (
        <Link key={item.href} href={item.href}>
          {item.label}
        </Link>
      ))}
    </>
  );
}
