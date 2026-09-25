export const metadata = {
  title: "Terms",
};

const DRAFT = "DRAFT — REQUIRES OPERATOR/LEGAL REVIEW";

export default function TermsPage() {
  return (
    <article className="legal-body">
      <p className="legal-draft" role="note">
        {DRAFT}
      </p>
      <h1>Terms of Service</h1>
      <p>
        These draft terms describe how the Osirus service may be used. They
        become binding only after the operator reviews and adopts them; until
        then this page documents the intended contract.
      </p>

      <h2>1. The service</h2>
      <p>
        Osirus is an agent workspace: you describe an objective, the service
        plans and executes steps for it, may use tools and connected systems
        with your approval, and reports a verification status for its results.
      </p>

      <h2>2. Accounts</h2>
      <p>
        You need an account (email or GitHub) to use the service. You are
        responsible for the activity in your account and keep your credentials
        safe.
      </p>

      <h2>3. Acceptable use</h2>
      <ul>
        <li>Do not use the service to break the law or others&apos; rights.</li>
        <li>
          Do not attack the service, other tenants, or the underlying
          infrastructure (probing, injection, scraping other users&apos; data,
          denial of service).
        </li>
        <li>
          Do not use the agent to generate content that is unlawful or harmful,
          or to evade model provider restrictions.
        </li>
      </ul>

      <h2>4. Approvals and side effects</h2>
      <p>
        Actions outside the isolated sandbox (for example pushing to a
        repository you connected) require your explicit approval in the product.
        An approval you grant is your instruction; the service records it.
      </p>

      <h2>5. Availability and model limits</h2>
      <p>
        The service is provided on a best-effort basis. Model capacity depends
        on third-party providers; when a provider limits requests or its quota
        is exhausted, runs wait, retry, or stop with an explanation. The service
        is not continuously available and may change.
      </p>

      <h2>6. AI output</h2>
      <p>
        Generated answers and code are produced by language models and may be
        wrong, incomplete, or unsuitable for your purpose. Review results before
        relying on them. The service labels verification status but does not
        guarantee correctness — it is not a professional advisor, and nothing
        here is legal, financial, or medical advice.
      </p>

      <h2>7. Billing</h2>
      <p>
        DRAFT — reserved for the upcoming paid plans. No payment is currently
        taken; when billing launches, the plan, prices, renewal and cancellation
        terms will be published here before checkout is enabled.
      </p>

      <h2>8. Termination</h2>
      <p>
        DRAFT — the operator must define termination rights, notice periods and
        data export before publication.
      </p>

      <h2>9. Liability</h2>
      <p>
        DRAFT — the operator must have liability limitations reviewed by counsel
        (German law typically distinguishes intent/gross negligence from
        ordinary negligence, and special regimes apply to injury to life, body
        or health).
      </p>

      <h2>10. Governing law</h2>
      <p>
        DRAFT — the operator chooses the governing law and venue (for a German
        operator typically the law of the Federal Republic of Germany).
      </p>
    </article>
  );
}
