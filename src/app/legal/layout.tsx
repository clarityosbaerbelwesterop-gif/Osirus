import Link from "next/link";
import type { ReactNode } from "react";
import { SiteFooterLinks } from "@/components/marketing/site-footer-links";

export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <main className="legal">
      <nav className="legal-nav" aria-label="Rechtliches">
        <Link className="legal-home" href="/">
          ← Osirus
        </Link>
      </nav>
      {children}
      <footer className="legal-footer">
        <SiteFooterLinks />
      </footer>
    </main>
  );
}
