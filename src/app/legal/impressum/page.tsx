import Link from "next/link";

export const metadata = {
  title: "Impressum",
};

const DRAFT = "DRAFT — REQUIRES OPERATOR/LEGAL REVIEW";

export default function ImpressumPage() {
  return (
    <article className="legal-body">
      <p className="legal-draft" role="note">
        {DRAFT}
      </p>
      <h1>Impressum</h1>
      <p>
        Angaben gemäß § 5 TMG (DRAFT: the operator must review and complete
        every field below before this page is published).
      </p>

      <h2>Anbieter / Provider</h2>
      <p>
        DRAFT — operator legal name
        <br />
        DRAFT — legal form (e.g. GmbH, Einzelunternehmen)
        <br />
        DRAFT — registered address
        <br />
        DRAFT — country of registration
      </p>

      <h2>Kontakt / Contact</h2>
      <p>
        DRAFT — contact email
        <br />
        DRAFT — contact phone (optional)
      </p>

      <h2>Vertretungsberechtigt / Represented by</h2>
      <p>DRAFT — name of the managing director or owner.</p>

      <h2>Registereintrag / Commercial register</h2>
      <p>
        DRAFT — register court (Registergericht) and register number
        (Registernummer), or a note that none applies.
      </p>

      <h2>Umsatzsteuer-ID / VAT ID</h2>
      <p>
        DRAFT — VAT identification number per § 27a UStG, or a note that none
        applies.
      </p>

      <h2>Verantwortlich für den Inhalt / Responsible for content</h2>
      <p>DRAFT — name and address per § 18 Abs. 2 MStV, if applicable.</p>

      <h2>Streitschlichtung / Dispute resolution</h2>
      <p>
        {" "}
        DRAFT — the operator decides whether to reference the EU Online Dispute
        Resolution platform and consumer arbitration boards. This page does not
        make that commitment on the operator&apos;s behalf.
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
