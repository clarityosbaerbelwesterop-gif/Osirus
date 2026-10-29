import {
  CANCELLABLE_STATUSES,
  type CancellationInput,
  type CancellationOutcome,
  type CancellationStatus,
  confirmationText,
  formatBerlinDateTime,
  type Operator,
  outcomeText,
  planSubscriptionCancellation,
  publicOutcomeText,
  type SubscriptionPlan,
  type SubscriptionState,
} from "./rules";

// Processing one declaration, kept free of I/O so it is testable: the route
// passes the database, Stripe, e-mail and inbox through `deps`.
//
// Order matters. The declaration is stored first, exactly as received, so it
// exists even when everything after it fails. Then it is matched to an
// account and its subscription, the subscription is set to end, the person
// gets the confirmation by e-mail and the operator gets an inbox entry.

export type CancellationDeps = {
  reference(): string;
  insert(row: {
    reference: string;
    declaration: CancellationInput;
    signedIn: boolean;
    networkHash: string | null;
  }): Promise<{ receivedAt: Date }>;
  update(
    reference: string,
    patch: {
      userId?: string | null;
      subscriptionId?: string | null;
      status?: CancellationStatus;
      effectiveAt?: Date | null;
      note?: string | null;
      confirmationSentAt?: Date;
    },
  ): Promise<void>;
  userIdForEmail(email: string): Promise<string | null>;
  accountEmail(userId: string): Promise<string | null>;
  subscriptionFor(userId: string): Promise<SubscriptionState | null>;
  /** Applies the plan in Stripe and returns the end Stripe now holds. */
  applyPlan(
    subscriptionId: string,
    plan: Exclude<SubscriptionPlan, { action: "none" }>,
  ): Promise<{ effectiveAt: Date | null }>;
  sendMail(message: {
    to: string[];
    subject: string;
    text: string;
    replyTo?: string;
  }): Promise<{ sent: boolean }>;
  notifyOperator(input: {
    reference: string;
    title: string;
    body: string;
  }): Promise<void>;
  operator: Operator;
  pageUrl: string;
  log?(message: string, data?: Record<string, unknown>): void;
};

export type CancellationReceipt = {
  reference: string;
  receivedAt: string;
  /** What the page shows: detailed when signed in, generic otherwise. */
  outcome: string;
  /** The text to save or print, matching what the page shows. */
  text: string;
  mailSent: boolean;
};

const STATUS_NOTE: Record<CancellationStatus, string> = {
  received: "eingegangen",
  scheduled: "Abo-Ende in Stripe gesetzt",
  already_ending: "Abo war bereits gekündigt",
  unmatched: "keinem laufenden Abo zugeordnet, bitte von Hand zuordnen",
  manual: "von Hand bearbeiten",
  failed: "Stripe-Fehler, bitte von Hand kündigen",
};

export async function processCancellation(
  declaration: CancellationInput,
  context: {
    signedInUserId: string | null;
    signedInEmail: string | null;
    networkHash: string | null;
  },
  deps: CancellationDeps,
): Promise<CancellationReceipt> {
  const reference = deps.reference();
  const signedIn = Boolean(context.signedInUserId);
  const { receivedAt } = await deps.insert({
    reference,
    declaration,
    signedIn,
    networkHash: context.networkHash,
  });

  let outcome: CancellationOutcome = { status: "received", effectiveAt: null };
  let userId: string | null = null;
  let subscriptionId: string | null = null;
  let note: string | null = null;
  try {
    userId =
      context.signedInUserId ?? (await deps.userIdForEmail(declaration.email));
    if (declaration.contract === "free") {
      outcome = { status: "manual", effectiveAt: receivedAt };
    } else if (!userId) {
      outcome = { status: "unmatched", effectiveAt: null };
    } else {
      const subscription = await deps.subscriptionFor(userId);
      if (!subscription || !CANCELLABLE_STATUSES.has(subscription.status)) {
        outcome = { status: "unmatched", effectiveAt: null };
        note = subscription
          ? `Abo im Status ${subscription.status}`
          : "kein Abo zum Konto";
      } else {
        subscriptionId = subscription.id;
        const plan = planSubscriptionCancellation(declaration, subscription);
        let effectiveAt = plan.effectiveAt;
        if (plan.action !== "none")
          effectiveAt =
            (await deps.applyPlan(subscription.id, plan)).effectiveAt ??
            plan.effectiveAt;
        outcome = {
          status:
            declaration.kind === "extraordinary"
              ? "manual"
              : plan.action === "none"
                ? "already_ending"
                : "scheduled",
          effectiveAt,
        };
      }
    }
  } catch (error) {
    deps.log?.("cancellation: processing failed", {
      reference,
      error: error instanceof Error ? error.message : String(error),
    });
    outcome = { status: "failed", effectiveAt: null };
    note = "Verarbeitung fehlgeschlagen";
  }

  await deps
    .update(reference, {
      userId,
      subscriptionId,
      status: outcome.status,
      effectiveAt: outcome.effectiveAt,
      note,
    })
    .catch((error) =>
      deps.log?.("cancellation: status update failed", {
        reference,
        error: error instanceof Error ? error.message : String(error),
      }),
    );

  // The e-mail goes to the address in the declaration and, when that is not
  // the account's address, to the account too: whoever owns the contract
  // learns of the cancellation.
  const detailed = outcomeText(declaration, outcome);
  const mailText = confirmationText({
    declaration,
    reference,
    receivedAt,
    outcome: detailed,
    pageUrl: deps.pageUrl,
    operator: deps.operator,
  });
  const accountAddress = userId
    ? (context.signedInEmail ??
      (await deps.accountEmail(userId).catch(() => null)))
    : null;
  const mail = await deps
    .sendMail({
      to: [declaration.email, ...(accountAddress ? [accountAddress] : [])],
      subject: `Bestätigung deiner Kündigung (${reference})`,
      text: mailText,
      replyTo: deps.operator.email,
    })
    .catch(() => ({ sent: false }));
  if (mail.sent)
    await deps
      .update(reference, { confirmationSentAt: new Date() })
      .catch(() => undefined);

  await deps
    .notifyOperator({
      reference,
      title: `Kündigung ${reference}: ${STATUS_NOTE[outcome.status]}`,
      body: [
        `${declaration.name} <${declaration.email}>`,
        `${declaration.contract === "free" ? "Kostenloses Konto" : "Abonnement"}, ${
          declaration.kind === "extraordinary"
            ? "außerordentlich"
            : "ordentlich"
        }`,
        outcome.effectiveAt
          ? `Ende: ${formatBerlinDateTime(outcome.effectiveAt)}`
          : null,
        note,
        mail.sent
          ? "Bestätigung per E-Mail versandt."
          : "Keine E-Mail versandt.",
      ]
        .filter(Boolean)
        .join(" · "),
    })
    .catch(() => undefined);

  const shown = signedIn ? detailed : publicOutcomeText(declaration);
  return {
    reference,
    receivedAt: receivedAt.toISOString(),
    outcome: shown,
    text: signedIn
      ? mailText
      : confirmationText({
          declaration,
          reference,
          receivedAt,
          outcome: shown,
          pageUrl: deps.pageUrl,
          operator: deps.operator,
        }),
    mailSent: mail.sent,
  };
}
