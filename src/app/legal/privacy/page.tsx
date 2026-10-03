export const metadata = {
  title: "Privacy",
};

const DRAFT = "DRAFT — REQUIRES OPERATOR/LEGAL REVIEW";
const TODO = "[[OPERATOR:";
const CONTACT_EMAIL = "clarityos.baerbelwesterop@gmail.com";

export default function PrivacyPage() {
  return (
    <article className="legal-body">
      <p className="legal-draft" role="note">
        {DRAFT}. This is not a lawyer-reviewed notice.
      </p>
      <h1>Privacy Notice (Datenschutzerklärung)</h1>
      <p>
        This notice describes, at the technical level of the current product,
        which personal data Osirus processes, why, on which legal basis, and for
        how long. Every commitment in it remains subject to operator/legal
        review; fields marked {TODO} …]] must be completed by the operator
        before publication.
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
      <ul>
        <li>
          <strong>Account data.</strong> Email address, display name and the
          authentication identity (email/password via Neon Auth, or GitHub
          OAuth). Purpose: providing the account. Source: your sign-up. Legal
          basis: Art. 6(1)(b) GDPR (performance of the user contract).
        </li>
        <li>
          <strong>Workspace content.</strong> Session titles, messages you send,
          run objectives, plans, stages, checkpoints and events. Purpose:
          running the agent and showing you your history. Legal basis: Art.
          6(1)(b) GDPR.
        </li>
        <li>
          <strong>Memory.</strong> Facts the agent learns from your sessions
          (episodic, semantic and related memory planes) so later runs can use
          them. Memory is scoped to your workspace. Legal basis: Art. 6(1)(b)
          GDPR.
        </li>
        <li>
          <strong>Attachments.</strong> Files you upload (currently up to
          10&nbsp;MB per file), parsed into text chunks for retrieval. Legal
          basis: Art. 6(1)(b) GDPR.
        </li>
        <li>
          <strong>Model call records.</strong> Per call: role, model identifier,
          token usage, latency, and an error category on failure. Prompts and
          completions are not stored in these records. Legal basis: Art. 6(1)(b)
          GDPR (service operation) and Art. 6(1)(f) GDPR (legitimate interest in
          capacity planning).
        </li>
        <li>
          <strong>Security events.</strong> Approval decisions, tool-call
          denials and rate-limit counters, for abuse prevention and audit. Legal
          basis: Art. 6(1)(f) GDPR (legitimate interest in the security of the
          service; the logs are append-only for the application role).
        </li>
      </ul>

      <h2>3. Who receives data (processors and recipients)</h2>
      <ul>
        <li>
          <strong>Neon, LLC</strong> (a Databricks company) — database hosting
          and authentication. Database region: European Union (eu-central-1,
          Frankfurt).
        </li>
        <li>
          <strong>Vercel Inc.</strong> — application hosting, serverless
          execution and sandbox execution.
        </li>
        <li>
          <strong>Model inference provider</strong> — message content is sent to
          the configured OpenAI-compatible provider to generate answers.
          {TODO} operator names the configured provider and its region here.]]
          Do not enter content you are not willing to process with the
          configured model provider.
        </li>
        <li>
          <strong>GitHub</strong> — only if you connect GitHub or use
          &quot;Continue with GitHub&quot;.
        </li>
      </ul>

      <h2>4. International transfers</h2>
      <p>
        Where personal data is processed outside the EU/EEA (the providers above
        are US entities), the transfer relies on the EU-U.S. Data Privacy
        Framework (DPF, Commission Implementing Decision (EU) 2023/1795): Vercel
        Inc. and Neon, LLC (via Databricks, Inc.) are DPF-certified;
        certifications can be verified at dataprivacyframework.gov. {TODO}{" "}
        operator confirms a data processing agreement (Art. 28 GDPR) is in place
        with each processor and records the fallback safeguard (EU Standard
        Contractual Clauses 2021/914) where applicable.]]
      </p>

      <h2>5. Retention and deletion</h2>
      <p>
        Workspace content is kept while your account exists so that sessions,
        runs and memory remain usable. {TODO} the operator defines concrete
        retention periods, a deletion procedure (account deletion request via
        the contact above), and backup expiry before publication.]]
      </p>

      <h2>6. Your rights</h2>
      <p>
        You have the rights of access (Art. 15), rectification (Art. 16),
        erasure (Art. 17), restriction of processing (Art. 18), data portability
        (Art. 20), and objection (Art. 21) GDPR; where processing is based on
        consent, you may withdraw it at any time with effect for the future
        (Art. 7(3)). Contact the controller above; requests are answered within
        one month (Art. 12(3)).
      </p>
      <p>
        You also have the right to lodge a complaint with a supervisory
        authority (Art. 77 GDPR). The authority competent for the
        controller&apos;s location is the Landesbeauftragte für Datenschutz und
        Informationsfreiheit Nordrhein-Westfalen (LDI NRW) (operator confirms).
      </p>

      <h2>7. Cookies and device storage (§ 25 TDDDG)</h2>
      <p>
        The product stores only what is technically required or explicitly
        requested by you:
      </p>
      <ul>
        <li>
          <strong>Neon Auth session cookies</strong> — keep you signed in.
          Strictly necessary (§ 25 Abs. 2 TDDDG; Art. 6(1)(b) GDPR).
        </li>
        <li>
          <strong>osirus-theme</strong> — your colour theme choice, stored for
          one year, SameSite=Lax. Set only when you choose a theme, so the
          server can render it on first paint (§ 25 Abs. 2 TDDDG as an expressly
          requested setting; Art. 6(1)(b) GDPR).
        </li>
        <li>
          <strong>osirus-sidebar</strong> — your sidebar collapsed/expanded
          choice, stored for one year, SameSite=Lax (same basis as the theme
          cookie).
        </li>
      </ul>
      <p>
        No analytics, advertising or tracking cookies are set, and no consent
        banner is therefore required. If non-essential storage is ever added, it
        will be activated only after prior consent (§ 25 Abs. 1 TDDDG).
      </p>

      <h2>8. What the agent does with connected systems</h2>
      <p>
        The agent may act on systems you connect (for example GitHub
        repositories) only after you approve each high-risk action. Approvals
        are recorded. Connected credentials are stored envelope-encrypted
        (AES-256-GCM); the database holds no plaintext credentials.
      </p>

      <h2>9. AI transparency</h2>
      <p>
        Answers are generated by a language model and can be wrong. Runs show
        their steps, and results are labelled with a verification status
        (verified, unverified, conflicted, rejected) rather than presented as
        fact. Generated answers may be processed by the model provider listed
        above.
      </p>

      <h2>10. People outside Germany and the EU</h2>
      <p>
        This draft is written for a product offered from North Rhine-Westphalia,
        Germany, and for the GDPR as it applies in the EU and EEA. If you use
        Osirus from elsewhere, the same processing described above still
        happens. This page does not claim that every other country&apos;s
        privacy law has been reviewed, and it does not waive rights you have
        where you live.
      </p>
    </article>
  );
}
