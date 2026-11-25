import Link from "next/link";

const PAGES = [
  {
    href: "/ueber-uns",
    label: "Über ClarityCompassAI und Osirus",
  },
  { href: "/osirus-ki", label: "Was Osirus KI ist" },
  {
    href: "/ki-team-freigabe",
    label: "So funktioniert der Freigabeknopf",
  },
  { href: "/sicherheit", label: "Sicherheit und Datenschutz" },
] as const;

export function RelatedPages({ current }: { current: string }) {
  const others = PAGES.filter((page) => page.href !== current);
  return (
    <nav className="related-pages" aria-label="Weiterlesen">
      <h2>Weiterlesen</h2>
      <ul>
        {others.map((page) => (
          <li key={page.href}>
            <Link href={page.href}>{page.label}</Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
