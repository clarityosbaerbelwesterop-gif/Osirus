import Link from "next/link";
import { PRICE_TAX_NOTE } from "@/components/marketing/plans";
import { OPERATOR } from "../operator";

export const metadata = {
  title: "Impressum",
};

export default function ImpressumPage() {
  return (
    <article className="legal-body" lang="de">
      <h1>Impressum</h1>
      <p>Angaben gemäß § 5 DDG (Digitale-Dienste-Gesetz)</p>

      <h2>Anbieterin</h2>
      <p>
        {OPERATOR.name}
        <br />
        Inhaberin: {OPERATOR.owner} (Einzelunternehmen)
        <br />
        {OPERATOR.street}
        <br />
        {OPERATOR.city}
        <br />
        {OPERATOR.country}
      </p>

      <h2>Kontakt</h2>
      <p>
        Telefon: <a href={OPERATOR.phoneHref}>{OPERATOR.phoneDisplay}</a>
        <br />
        E-Mail (Geschäft und Support):{" "}
        <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a>
      </p>

      <h2>Umsatzsteuer</h2>
      <p>{PRICE_TAX_NOTE} Die Anbieterin ist Kleinunternehmerin.</p>

      <h2>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</h2>
      <p>
        {OPERATOR.owner}, {OPERATOR.street}, {OPERATOR.city}
      </p>

      <h2>Zentrale Kontaktstelle nach dem Digital Services Act</h2>
      <p>
        Kontaktstelle für Behörden und Nutzer nach Art. 11 und 12 der Verordnung
        (EU) 2022/2065 (DSA):{" "}
        <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a>. Wir
        kommunizieren auf Deutsch und Englisch.
      </p>

      <h2>Meldung rechtswidriger Inhalte</h2>
      <p>
        Inhalte, die Nutzer über Teilen-Links öffentlich zugänglich machen,
        kannst du uns nach Art. 16 DSA per E-Mail an{" "}
        <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a> melden. Nenne
        bitte die genaue Adresse des Inhalts, eine Begründung, warum er
        rechtswidrig ist, und deinen Namen und deine E-Mail-Adresse (außer bei
        Meldungen zu Straftaten gegen die sexuelle Selbstbestimmung von
        Kindern). Wir prüfen jede Meldung zeitnah, sorgfältig und objektiv und
        teilen dir unsere Entscheidung mit.
      </p>

      <h2>Verbraucherstreitbeilegung</h2>
      <p>
        Wir sind nicht verpflichtet und nicht bereit, an einem
        Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle
        teilzunehmen (§ 36 VSBG).
      </p>

      <h2>Hinweis zu KI-Inhalten</h2>
      <p>
        Osirus ist ein KI-System. Antworten, Code und andere Ergebnisse in der
        Anwendung werden durch KI erzeugt (Art. 50 der Verordnung (EU)
        2024/1689) und können Fehler enthalten.
      </p>

      <h2>Haftung für Inhalte</h2>
      <p>
        Für eigene Inhalte dieser Website sind wir nach den allgemeinen Gesetzen
        verantwortlich. Für fremde Informationen, die wir übermitteln oder für
        Nutzer speichern, etwa über Teilen-Links geteilte Chats, sind wir nach
        den Art. 4 bis 6 DSA nicht verpflichtet, sie zu überwachen oder nach
        Umständen zu forschen, die auf eine rechtswidrige Tätigkeit hinweisen.
        Sobald wir von einer konkreten Rechtsverletzung Kenntnis erhalten,
        entfernen wir den Inhalt oder sperren den Zugang unverzüglich.
      </p>

      <h2>Haftung für Links</h2>
      <p>
        Unser Angebot und von KI erzeugte Antworten können Links zu Websites
        Dritter enthalten, auf deren Inhalte wir keinen Einfluss haben. Für
        diese Inhalte ist der jeweilige Anbieter verantwortlich. Bei Kenntnis
        einer Rechtsverletzung entfernen wir eigene Links unverzüglich.
      </p>

      <h2>Urheberrecht</h2>
      <p>
        Die von uns erstellten Inhalte und Werke auf dieser Website unterliegen
        dem deutschen Urheberrecht. Vervielfältigung, Bearbeitung und
        Verbreitung außerhalb der Grenzen des Urheberrechts bedürfen unserer
        Zustimmung. Was du mit Osirus erzeugst, darfst du nach der{" "}
        <Link href="/legal/eula">EULA</Link> verwenden.
      </p>

      <h2>Technische Dienstleister</h2>
      <p>
        Diese Anwendung wird bei Vercel Inc. gehostet und nutzt Neon (Datenbank
        und Anmeldung), Stripe (Zahlungen) sowie Modellanbieter über deren
        Schnittstellen. Einzelheiten stehen in der{" "}
        <Link href="/legal/privacy">Datenschutzerklärung</Link>.
      </p>
    </article>
  );
}
