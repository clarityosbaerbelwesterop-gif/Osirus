import Link from "next/link";

export const metadata = {
  title: "Impressum",
};

const DRAFT = "DRAFT — REQUIRES OPERATOR/LEGAL REVIEW";
const TODO = "[[OPERATOR:";
const CONTACT_EMAIL = "clarityos.baerbelwesterop@gmail.com";

export default function ImpressumPage() {
  return (
    <article className="legal-body">
      <p className="legal-draft" role="note">
        {DRAFT}. This is not a lawyer-reviewed notice.
      </p>
      <h1>Impressum</h1>
      <p>
        Draft imprint for a service offered from North Rhine-Westphalia
        (Nordrhein-Westfalen), Germany. It also notes the EU and, briefly, use
        from outside the EU. Do not treat missing fields as filled in.
      </p>
      <p>
        Angaben gemäß § 5 DDG (Digitale-Dienste-Gesetz). The operator must
        review and complete every field marked {TODO} …]] before this page is
        treated as published. Fields without a marker are filled from the
        project identity and still require operator confirmation.
      </p>

      <h2>Anbieter / Provider</h2>
      <p>
        Bärbel Westerop
        <br />
        ClarityCompassAI (project: Osirus)
        <br />
        {TODO} legal form — e.g. Einzelunternehmen; do not publish a GmbH/UG
        form that is not registered]]
        <br />
        {TODO} street and house number]]
        <br />
        47447 Moers
        <br />
        Germany
      </p>

      <h2>Kontakt / Contact</h2>
      <p>
        E-Mail: {CONTACT_EMAIL} (drafted from the project mailbox — operator
        confirms this is the public contact address)
        <br />
        {TODO} telephone or a second channel for rapid electronic contact — § 5
        DDG requires one in addition to the email address]]
      </p>

      <h2>Vertretungsberechtigt / Represented by</h2>
      <p>Bärbel Westerop (operator confirms).</p>

      <h2>Registereintrag / Commercial register</h2>
      <p>
        {TODO} register court (Registergericht) and register number, or the
        statement that no register entry exists]]
      </p>

      <h2>Umsatzsteuer / VAT</h2>
      <p>
        {TODO} VAT identification number per § 27a UStG, or the statement that
        none has been issued. If a Wirtschafts-Identifikationsnummer (§ 139c AO)
        has been assigned, list it here as well]]
      </p>

      <h2>Verantwortlich für den Inhalt / Responsible for content</h2>
      <p>
        Bärbel Westerop, address as above — per § 18 Abs. 2 MStV, if and when
        this site publishes journalistic or editorial content. The operator
        confirms whether this designation is required.
      </p>

      <h2>Verbraucherstreitbeilegung / Consumer dispute resolution</h2>
      <p>
        {TODO} operator confirms the § 36 VSBG statement. Drafted default:
        &quot;Wir sind nicht verpflichtet und nicht bereit, an einem
        Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle
        teilzunehmen.&quot; (We are neither obliged nor willing to participate
        in dispute resolution proceedings before a consumer arbitration
        board.)]]
      </p>
      <p>
        Note: the European Commission&apos;s Online Dispute Resolution platform
        was discontinued on 20 July 2025 (Regulation (EU) 2024/3228). The former
        obligation to link it no longer applies, which is why this page does not
        reference it.
      </p>

      <h2>Technischer Dienstleister / Technical service providers</h2>
      <p>
        This application is hosted by Vercel Inc. and uses Neon (database and
        authentication) and third-party model inference. The full inventory is
        described in the <Link href="/legal/privacy">privacy notice</Link>.
      </p>
    </article>
  );
}
