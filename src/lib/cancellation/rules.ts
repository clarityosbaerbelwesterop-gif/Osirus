import { z } from "zod";

// The cancellation page (§ 312k BGB) without I/O: what a declaration must
// contain, when a subscription ends because of it, and the confirmation text
// the person saves and receives. The service and the route add the database,
// Stripe and e-mail around this.

export const CONTRACT_LABEL = {
  subscription: "Osirus-Abonnement (Pro, Developer oder Ultra)",
  free: "Kostenloses Osirus-Konto",
} as const;

export const KIND_LABEL = {
  ordinary: "Ordentliche Kündigung",
  extraordinary: "Außerordentliche (fristlose) Kündigung",
} as const;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value.replace(/\s+/g, " "));

export const cancellationSchema = z
  .object({
    name: text(120).pipe(z.string().min(2)),
    email: z.string().trim().toLowerCase().max(200).email(),
    contract: z.enum(["subscription", "free"]),
    customerReference: text(120).optional(),
    kind: z.enum(["ordinary", "extraordinary"]),
    reason: z.string().trim().max(2000).optional(),
    timing: z.enum(["earliest", "date"]),
    requestedEnd: z.string().regex(DAY).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.kind === "extraordinary" && (value.reason ?? "").length < 3)
      ctx.addIssue({
        code: "custom",
        path: ["reason"],
        message: "reason_required",
      });
    if (value.timing === "date" && !value.requestedEnd)
      ctx.addIssue({
        code: "custom",
        path: ["requestedEnd"],
        message: "date_required",
      });
  })
  .transform((value) => ({
    ...value,
    customerReference: value.customerReference || undefined,
    reason: value.kind === "extraordinary" ? value.reason : undefined,
    requestedEnd: value.timing === "date" ? value.requestedEnd : undefined,
  }));

export type CancellationInput = z.output<typeof cancellationSchema>;

const BERLIN = "Europe/Berlin";

/** The calendar day in Berlin, as YYYY-MM-DD. */
export function berlinDay(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BERLIN,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

function berlinOffsetMinutes(at: Date): number {
  const name =
    new Intl.DateTimeFormat("en-US", {
      timeZone: BERLIN,
      timeZoneName: "shortOffset",
    })
      .formatToParts(at)
      .find((part) => part.type === "timeZoneName")?.value ?? "GMT+1";
  const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
  if (!match) return 60;
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return match[1] === "-" ? -minutes : minutes;
}

/** The instant a day ends in Berlin: midnight at the start of the next day. */
export function endOfBerlinDay(day: string): Date {
  const [year, month, date] = day.split("-").map(Number);
  const guess = Date.UTC(year!, month! - 1, date! + 1, 0, 0, 0);
  return new Date(guess - berlinOffsetMinutes(new Date(guess)) * 60_000);
}

/** A requested end must not lie in the past. */
export function requestedEndValid(day: string | undefined, now: Date) {
  return !day || day >= berlinDay(now);
}

export function formatBerlinDateTime(at: Date): string {
  return `${at.toLocaleString("de-DE", {
    timeZone: BERLIN,
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })} Uhr`;
}

/** A Date, or a YYYY-MM-DD day, as "15. November 2026". */
export function formatBerlinDate(at: Date | string): string {
  // Noon UTC is the same calendar day in Berlin all year.
  const date = typeof at === "string" ? new Date(`${at}T12:00:00Z`) : at;
  return date.toLocaleDateString("de-DE", {
    timeZone: BERLIN,
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

const REFERENCE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** A short, readable reference: K-20261029-7QX4MZ. */
export function cancellationReference(now: Date): string {
  const random = Array.from(
    crypto.getRandomValues(new Uint8Array(6)),
    (byte) => REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length],
  ).join("");
  return `K-${berlinDay(now).replaceAll("-", "")}-${random}`;
}

/** Subscription states that still renew or bill, so a cancellation acts on them. */
export const CANCELLABLE_STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "paused",
]);

export type SubscriptionState = {
  id: string;
  status: string;
  periodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
};

export type SubscriptionPlan =
  | { action: "none"; effectiveAt: Date | null }
  | { action: "period_end"; effectiveAt: Date | null }
  | { action: "at"; at: Date; effectiveAt: Date };

/**
 * When the subscription ends. An ordinary cancellation ends a monthly
 * subscription at the end of the running period; a later requested day ends
 * it at the end of that day (Stripe bills the last part pro rata). An
 * extraordinary cancellation is scheduled the same way at the latest, and the
 * operator reviews whether it ends earlier.
 */
export function planSubscriptionCancellation(
  input: { timing: CancellationInput["timing"]; requestedEnd?: string },
  subscription: SubscriptionState,
): SubscriptionPlan {
  if (input.timing === "date" && input.requestedEnd) {
    const at = endOfBerlinDay(input.requestedEnd);
    if (subscription.periodEnd && at > subscription.periodEnd)
      return { action: "at", at, effectiveAt: at };
  }
  if (subscription.cancelAtPeriodEnd)
    return { action: "none", effectiveAt: subscription.periodEnd };
  return { action: "period_end", effectiveAt: subscription.periodEnd };
}

export type CancellationStatus =
  | "received"
  | "scheduled"
  | "already_ending"
  | "unmatched"
  | "manual"
  | "failed";

export type CancellationOutcome = {
  status: CancellationStatus;
  effectiveAt: Date | null;
};

function wish(input: CancellationInput) {
  return input.timing === "date" && input.requestedEnd
    ? `zum ${formatBerlinDate(input.requestedEnd)}`
    : "zum nächstmöglichen Zeitpunkt";
}

/** What happens to the contract, in one or two sentences. */
export function outcomeText(
  input: CancellationInput,
  outcome: CancellationOutcome,
): string {
  const end = outcome.effectiveAt
    ? formatBerlinDateTime(outcome.effectiveAt)
    : null;
  if (input.contract === "free")
    return "Dein kostenloses Nutzungsverhältnis endet mit Eingang dieser Kündigung. Wir schließen dein Konto innerhalb von 14 Tagen und bestätigen dir das. Bis dahin kannst du dich weiter anmelden und deine Inhalte sichern.";
  if (input.kind === "extraordinary" && end)
    return `Wir prüfen den angegebenen Grund und melden uns innerhalb von drei Werktagen. Unabhängig davon endet dein Abonnement spätestens am ${end} (hilfsweise als ordentliche Kündigung zum nächstmöglichen Zeitpunkt).`;
  if (outcome.status === "already_ending" && end)
    return `Dein Abonnement war bereits gekündigt und endet am ${end}. Es verlängert sich nicht mehr.`;
  if (outcome.status === "scheduled" && end)
    return `Dein Abonnement endet am ${end}. Bis dahin nutzt du deinen Plan wie gewohnt, danach gilt wieder das kostenlose Kontingent. Dein Konto und deine Inhalte bleiben erhalten.`;
  return `Deine Kündigung wirkt ${wish(input)}. Wir ordnen sie deinem Vertrag zu und teilen dir das genaue Vertragsende innerhalb von drei Werktagen mit.`;
}

/**
 * What the page shows someone who is not signed in. It never says whether
 * the address has an account or a subscription; the details go by e-mail to
 * that address only.
 */
export function publicOutcomeText(input: CancellationInput): string {
  if (input.contract === "free")
    return "Dein kostenloses Nutzungsverhältnis endet mit Eingang dieser Kündigung. Wir schließen dein Konto innerhalb von 14 Tagen und bestätigen dir das per E-Mail.";
  return `Deine Kündigung wirkt ${wish(input)}. Das genaue Vertragsende bestätigen wir dir per E-Mail an ${input.email}.`;
}

export type Operator = {
  name: string;
  owner: string;
  street: string;
  city: string;
  email: string;
};

/** The declaration as received, for the download, the print view and the e-mail. */
export function confirmationText(input: {
  declaration: CancellationInput;
  reference: string;
  receivedAt: Date;
  outcome: string;
  pageUrl: string;
  operator: Operator;
}): string {
  const d = input.declaration;
  const lines = [
    "Bestätigung deiner Kündigung",
    "",
    `Eingang: ${formatBerlinDateTime(input.receivedAt)} (Ortszeit Berlin)`,
    `Vorgangsnummer: ${input.reference}`,
    "",
    "Deine Kündigungserklärung",
    `Name: ${d.name}`,
    `E-Mail-Adresse: ${d.email}`,
    `Vertrag: ${CONTRACT_LABEL[d.contract]}`,
    ...(d.customerReference
      ? [`Kunden- oder Rechnungsnummer: ${d.customerReference}`]
      : []),
    `Art der Kündigung: ${KIND_LABEL[d.kind]}`,
    ...(d.reason ? [`Kündigungsgrund: ${d.reason}`] : []),
    `Gewünschtes Vertragsende: ${
      d.timing === "date" && d.requestedEnd
        ? formatBerlinDate(d.requestedEnd)
        : "Zum nächstmöglichen Zeitpunkt"
    }`,
    "",
    "Vertragsende",
    input.outcome,
    "",
    `Abgegeben über die Kündigungsseite ${input.pageUrl} mit der Schaltfläche „Jetzt kündigen“.`,
    "",
    `${input.operator.name}, Inhaberin ${input.operator.owner}`,
    `${input.operator.street}, ${input.operator.city}`,
    input.operator.email,
  ];
  return `${lines.join("\n")}\n`;
}
