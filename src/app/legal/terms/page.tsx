export const metadata = {
  title: "Terms",
};

const DRAFT = "DRAFT — REQUIRES OPERATOR/LEGAL REVIEW";
const TODO = "[[OPERATOR:";
const CONTACT_EMAIL = "clarityos.baerbelwesterop@gmail.com";

export default function TermsPage() {
  return (
    <article className="legal-body">
      <p className="legal-draft" role="note">
        {DRAFT}
      </p>
      <h1>Terms of Service (AGB)</h1>
      <p>
        These draft terms describe how the Osirus service may be used. They
        become binding only after the operator reviews and adopts them; until
        then this page documents the intended contract. Fields marked {TODO} …]]
        require an operator decision.
      </p>

      <h2>1. The service</h2>
      <p>
        Osirus is an agent workspace operated by Bärbel Westerop —
        ClarityCompassAI, 47447 Moers, Germany (contact: {CONTACT_EMAIL}). You
        describe an objective, the service plans and executes steps for it, may
        use tools and connected systems with your approval, and reports a
        verification status for its results.
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
        No payment is currently taken. When billing launches, the plan, prices,
        renewal and cancellation terms will be published here before checkout is
        enabled.
      </p>

      <h2>8. Term and termination</h2>
      <p>
        The contract runs while your account exists. You may delete your account
        at any time; on deletion your workspace content is removed according to
        the retention section of the privacy notice. The operator may suspend or
        terminate accounts that breach section 3, with prior notice where
        reasonable. {TODO} operator confirms the notice period and the
        data-export window after termination.]]
      </p>

      <h2>9. Liability (Haftung)</h2>
      <p>
        {TODO} operator has this clause reviewed by counsel. Drafted under
        standard German-law structure:]] The operator is liable without
        limitation for intent and gross negligence, for injury to life, body or
        health, and under the Produkthaftungsgesetz where applicable. For
        ordinary negligence the operator is liable only for breach of a cardinal
        duty (a duty whose fulfilment makes the proper performance of the
        contract possible in the first place), and then limited to the
        foreseeable, typically occurring damage. Liability for data loss is
        limited to the cost of restoration from a backup the user could
        reasonably have expected to exist. Mandatory statutory liability remains
        unaffected.
      </p>

      <h2>10. Governing law</h2>
      <p>
        These terms are governed by the law of the Federal Republic of Germany,
        excluding the UN Convention on Contracts for the International Sale of
        Goods. If you are a consumer, mandatory consumer-protection provisions
        of your country of residence remain unaffected. {TODO} operator confirms
        venue for business users, if one is desired.]]
      </p>

      <h2>11. Changes to these terms</h2>
      <p>
        The operator may update these terms with reasonable advance notice;
        continued use after the effective date constitutes acceptance. {TODO}
        operator confirms the notice channel (in-app notice or email).]]
      </p>
    </article>
  );
}
