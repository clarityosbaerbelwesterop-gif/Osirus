import Link from "next/link";

export const metadata = {
  title: "Cookies",
  description:
    "Cookie and device-storage notice for Osirus: the strictly necessary and expressly requested storage the product uses under § 25 TDDDG.",
  robots: { index: true },
};

const DRAFT = "DRAFT — REQUIRES OPERATOR/LEGAL REVIEW";
const TODO = "[[OPERATOR:";
const CONTACT_EMAIL = "clarityos.baerbelwesterop@gmail.com";

export default function CookiesPage() {
  return (
    <article className="legal-body">
      <p className="legal-draft" role="note">
        {DRAFT}
      </p>
      <h1>Cookie &amp; Storage Notice</h1>
      <p>
        This notice lists every cookie and every browser storage entry Osirus
        sets, why it is set, on which legal basis, and for how long. It
        complements the <Link href="/legal/privacy">privacy notice</Link>.
        Fields marked {TODO} …]] must be completed by the operator before this
        page is treated as published.
      </p>

      <h2>1. Controller (Verantwortlicher)</h2>
      <p>
        Bärbel Westerop — ClarityCompassAI (project: Osirus)
        <br />
        {TODO} street and house number]], 47447 Moers, Germany
        <br />
        E-Mail: {CONTACT_EMAIL} (operator confirms)
      </p>

      <h2>2. What is stored, why, and on which legal basis</h2>
      <p>
        The product stores only what is technically required to deliver the
        service or what you expressly request through a setting:
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Purpose</th>
              <th>Legal basis</th>
              <th>Duration</th>
              <th>Type</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Neon Auth session cookie(s)</td>
              <td>Keep you signed in to your account.</td>
              <td>
                Strictly necessary — § 25 Abs. 2 TDDDG; Art. 6(1)(b) GDPR.
              </td>
              <td>Session (ends on sign-out or session expiry).</td>
              <td>First-party cookie, HttpOnly.</td>
            </tr>
            <tr>
              <td>osirus-theme</td>
              <td>
                Your colour theme choice, so the server renders it on first
                paint. Set only when you choose a theme.
              </td>
              <td>
                Expressly requested setting — § 25 Abs. 2 TDDDG; Art. 6(1)(b)
                GDPR.
              </td>
              <td>1 year (Max-Age), SameSite=Lax, Secure over https.</td>
              <td>First-party cookie.</td>
            </tr>
            <tr>
              <td>osirus-sidebar</td>
              <td>Your sidebar collapsed/expanded choice.</td>
              <td>
                Expressly requested setting — § 25 Abs. 2 TDDDG; Art. 6(1)(b)
                GDPR.
              </td>
              <td>1 year (Max-Age), SameSite=Lax, Secure over https.</td>
              <td>First-party cookie.</td>
            </tr>
            <tr>
              <td>osirus-mode</td>
              <td>
                Your agent mode choice (auto, research, coding, reasoning,
                agent).
              </td>
              <td>
                Expressly requested setting — § 25 Abs. 2 TDDDG; Art. 6(1)(b)
                GDPR.
              </td>
              <td>1 year (Max-Age), SameSite=Lax, Secure over https.</td>
              <td>First-party cookie.</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        The application does not use browser Web Storage (localStorage or
        sessionStorage).
      </p>

      <h2>3. Why there is no consent banner</h2>
      <p>
        § 25 Abs. 2 TDDDG exempts storage from consent where it is strictly
        necessary to deliver a service you requested (the sign-in session) or
        where it stores a setting you expressly chose (theme, sidebar, mode).
        Osirus sets no analytics, advertising or tracking cookies, no tracking
        pixels, and no third-party embeds. Because every entry above falls under
        the exemption, no consent banner is required.
      </p>

      <h2>4. If that changes</h2>
      <p>
        If non-essential storage is ever added (for example analytics), it will
        be activated only after your prior consent through a consent mechanism
        (§ 25 Abs. 1 TDDDG), and this notice will be updated before activation.
      </p>

      <h2>5. Deleting cookies</h2>
      <p>
        You can delete or block cookies at any time in your browser settings
        (usually under &quot;Privacy&quot; or &quot;Site data&quot;). Deleting
        the preference cookies resets the theme, sidebar and mode to their
        defaults; deleting the session cookie signs you out. Blocking the
        session cookie prevents sign-in; the preference settings then only apply
        until the tab is closed.
      </p>

      <h2>6. Contact</h2>
      <p>
        Questions about storage on this site: {CONTACT_EMAIL} (operator confirms
        this is the public contact address).
      </p>
    </article>
  );
}
