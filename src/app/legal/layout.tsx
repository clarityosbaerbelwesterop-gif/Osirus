import Link from "next/link";
import type { ReactNode } from "react";

export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <main className="legal">
      <nav className="legal-nav" aria-label="Legal">
        <Link className="legal-home" href="/">
          ← Osirus
        </Link>
      </nav>
      {children}
      <footer className="legal-footer">
        <Link href="/legal/impressum">Impressum</Link>
        <Link href="/legal/privacy">Privacy</Link>
        <Link href="/legal/terms">Terms</Link>
      </footer>
    </main>
  );
}
