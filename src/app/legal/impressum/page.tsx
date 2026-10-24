import Link from "next/link";

export const metadata = {
  title: "Impressum",
};

const CONTACT_EMAIL = "clarityos.baerbelwesterop@gmail.com";
const PHONE_DISPLAY = "+49 160 94486598";
const PHONE_HREF = "tel:+4916094486598";

export default function ImpressumPage() {
  return (
    <article className="legal-body" lang="de">
      <h1>Impressum</h1>
      <p>Angaben gemäß § 5 DDG (Digitale-Dienste-Gesetz)</p>

      <h2>Anbieter</h2>
      <p>
        ClarityCompassAI
        <br />
        Inhaberin: Bärbel Westerop
        <br />
        Drinhausstraße 22
        <br />
        47447 Moers-Kapellen
        <br />
        Deutschland
      </p>

      <h2>Kontakt</h2>
      <p>
        Telefon: <a href={PHONE_HREF}>{PHONE_DISPLAY}</a>
        <br />
        E-Mail (Geschäft und Support):{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
      </p>

      <h2>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</h2>
      <p>Bärbel Westerop, Anschrift wie oben</p>

      <h2>Verbraucherstreitbeilegung (§ 36 VSBG)</h2>
      <p>
        Wir sind nicht verpflichtet und nicht bereit, an einem
        Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle
        teilzunehmen.
      </p>

      <h2>Technische Dienstleister</h2>
      <p>
        Diese Anwendung wird bei Vercel Inc. gehostet und nutzt Neon (Datenbank
        und Anmeldung) sowie Modell-Anbieter über eine API. Einzelheiten stehen
        in der <Link href="/legal/privacy">Datenschutzerklärung</Link>.
      </p>
    </article>
  );
}
