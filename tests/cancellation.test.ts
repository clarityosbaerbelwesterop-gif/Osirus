import { describe, expect, it, vi } from "vitest";
import {
  type CancellationDeps,
  processCancellation,
} from "../src/lib/cancellation/process";
import {
  berlinDay,
  cancellationReference,
  cancellationSchema,
  confirmationText,
  endOfBerlinDay,
  planSubscriptionCancellation,
  requestedEndValid,
} from "../src/lib/cancellation/rules";

const OPERATOR = {
  name: "ClarityCompassAI",
  owner: "Bärbel Westerop",
  street: "Drinhausstraße 22",
  city: "47447 Moers-Kapellen",
  email: "betrieb@example.com",
};

const declaration = (overrides: Record<string, unknown> = {}) =>
  cancellationSchema.parse({
    name: "Erika Mustermann",
    email: "Erika@Example.com",
    contract: "subscription",
    kind: "ordinary",
    timing: "earliest",
    ...overrides,
  });

const RECEIVED = new Date("2026-10-29T13:05:33Z");
const PERIOD_END = new Date("2026-11-20T09:00:00Z");

function fakeDeps(overrides: Partial<CancellationDeps> = {}) {
  const updates: Array<Record<string, unknown>> = [];
  const mails: Array<{ to: string[]; subject: string; text: string }> = [];
  const notes: Array<{ title: string; body: string }> = [];
  const deps: CancellationDeps = {
    reference: () => "K-20261029-TEST01",
    insert: vi.fn(async () => ({ receivedAt: RECEIVED })),
    update: vi.fn(async (_reference, patch) => {
      updates.push(patch);
    }),
    userIdForEmail: vi.fn(async (email: string) =>
      email === "erika@example.com" ? "user-1" : null,
    ),
    accountEmail: vi.fn(async () => "erika@example.com"),
    subscriptionFor: vi.fn(async () => ({
      id: "sub_1",
      status: "active",
      periodEnd: PERIOD_END,
      cancelAtPeriodEnd: false,
    })),
    applyPlan: vi.fn(async () => ({ effectiveAt: PERIOD_END })),
    sendMail: vi.fn(async (message) => {
      mails.push(message);
      return { sent: true };
    }),
    notifyOperator: vi.fn(async (input) => {
      notes.push(input);
    }),
    operator: OPERATOR,
    pageUrl: "https://osirus-ai.vercel.app/kuendigen",
    ...overrides,
  };
  return { deps, updates, mails, notes };
}

const anonymous = {
  signedInUserId: null,
  signedInEmail: null,
  networkHash: "h",
};

describe("cancellation rules", () => {
  it("accepts a minimal declaration and normalises the address", () => {
    const value = declaration({
      reason: "ignored",
      requestedEnd: "2026-12-01",
    });
    expect(value.email).toBe("erika@example.com");
    expect(value.reason).toBeUndefined();
    expect(value.requestedEnd).toBeUndefined();
  });

  it("requires a reason for an extraordinary cancellation and a day for a date", () => {
    expect(
      cancellationSchema.safeParse({
        name: "Erika Mustermann",
        email: "erika@example.com",
        contract: "subscription",
        kind: "extraordinary",
        timing: "earliest",
      }).success,
    ).toBe(false);
    expect(
      cancellationSchema.safeParse({
        name: "Erika Mustermann",
        email: "erika@example.com",
        contract: "subscription",
        kind: "ordinary",
        timing: "date",
      }).success,
    ).toBe(false);
    expect(
      cancellationSchema.safeParse({
        name: "E",
        email: "kein-adresse",
        contract: "subscription",
        kind: "ordinary",
        timing: "earliest",
      }).success,
    ).toBe(false);
  });

  it("ends a day at midnight Berlin time, in winter and in summer", () => {
    expect(endOfBerlinDay("2026-11-15").toISOString()).toBe(
      "2026-11-15T23:00:00.000Z",
    );
    expect(endOfBerlinDay("2026-07-01").toISOString()).toBe(
      "2026-07-01T22:00:00.000Z",
    );
    expect(berlinDay(new Date("2026-10-29T23:30:00Z"))).toBe("2026-10-30");
  });

  it("rejects a requested end in the past", () => {
    const now = new Date("2026-10-29T10:00:00Z");
    expect(requestedEndValid("2026-10-28", now)).toBe(false);
    expect(requestedEndValid("2026-10-29", now)).toBe(true);
    expect(requestedEndValid(undefined, now)).toBe(true);
  });

  it("ends a subscription at the period end, or later on request", () => {
    const subscription = {
      id: "sub_1",
      status: "active",
      periodEnd: PERIOD_END,
      cancelAtPeriodEnd: false,
    };
    expect(
      planSubscriptionCancellation({ timing: "earliest" }, subscription),
    ).toEqual({ action: "period_end", effectiveAt: PERIOD_END });
    // A day before the period end cannot end it earlier.
    expect(
      planSubscriptionCancellation(
        { timing: "date", requestedEnd: "2026-11-05" },
        subscription,
      ),
    ).toEqual({ action: "period_end", effectiveAt: PERIOD_END });
    const later = planSubscriptionCancellation(
      { timing: "date", requestedEnd: "2027-01-31" },
      subscription,
    );
    expect(later).toMatchObject({ action: "at" });
    expect(later.effectiveAt?.toISOString()).toBe("2027-01-31T23:00:00.000Z");
    expect(
      planSubscriptionCancellation(
        { timing: "earliest" },
        { ...subscription, cancelAtPeriodEnd: true },
      ),
    ).toEqual({ action: "none", effectiveAt: PERIOD_END });
  });

  it("writes a confirmation with everything § 312k BGB asks for", () => {
    const text = confirmationText({
      declaration: declaration({
        kind: "extraordinary",
        reason: "Dienst dauerhaft nicht erreichbar",
        timing: "date",
        requestedEnd: "2026-12-31",
        customerReference: "cus_123",
      }),
      reference: "K-20261029-TEST01",
      receivedAt: RECEIVED,
      outcome: "Dein Abonnement endet am 20. November 2026.",
      pageUrl: "https://osirus-ai.vercel.app/kuendigen",
      operator: OPERATOR,
    });
    expect(text).toContain("Eingang: 29. Oktober 2026 um 14:05:33 Uhr");
    expect(text).toContain("Vorgangsnummer: K-20261029-TEST01");
    expect(text).toContain("Name: Erika Mustermann");
    expect(text).toContain("E-Mail-Adresse: erika@example.com");
    expect(text).toContain("Kunden- oder Rechnungsnummer: cus_123");
    expect(text).toContain("Außerordentliche (fristlose) Kündigung");
    expect(text).toContain(
      "Kündigungsgrund: Dienst dauerhaft nicht erreichbar",
    );
    expect(text).toContain("Gewünschtes Vertragsende: 31. Dezember 2026");
    expect(text).toContain("Dein Abonnement endet am 20. November 2026.");
    expect(text).toContain("„Jetzt kündigen“");
    expect(text).toContain("https://osirus-ai.vercel.app/kuendigen");
    expect(text).toContain("Drinhausstraße 22");
  });

  it("makes readable, unique-looking references", () => {
    const reference = cancellationReference(RECEIVED);
    expect(reference).toMatch(/^K-20261029-[A-HJ-NP-Z2-9]{6}$/);
  });
});

describe("processing a cancellation", () => {
  it("anonymous: schedules the period end, mails the details, shows nothing account-specific", async () => {
    const { deps, updates, mails, notes } = fakeDeps();
    const receipt = await processCancellation(declaration(), anonymous, deps);
    expect(deps.applyPlan).toHaveBeenCalledWith("sub_1", {
      action: "period_end",
      effectiveAt: PERIOD_END,
    });
    expect(updates[0]).toMatchObject({
      userId: "user-1",
      subscriptionId: "sub_1",
      status: "scheduled",
      effectiveAt: PERIOD_END,
    });
    expect(updates[1]).toHaveProperty("confirmationSentAt");
    // The page does not reveal that the address has a subscription.
    expect(receipt.outcome).not.toContain("20. November 2026");
    expect(receipt.outcome).toContain("zum nächstmöglichen Zeitpunkt");
    expect(receipt.text).toContain("Eingang: 29. Oktober 2026 um 14:05:33 Uhr");
    // The e-mail to the address carries the exact end.
    expect(mails[0]!.to).toEqual(["erika@example.com", "erika@example.com"]);
    expect(mails[0]!.text).toContain(
      "Dein Abonnement endet am 20. November 2026",
    );
    expect(mails[0]!.subject).toContain("K-20261029-TEST01");
    expect(notes[0]!.title).toContain("Abo-Ende in Stripe gesetzt");
    expect(receipt).toMatchObject({
      reference: "K-20261029-TEST01",
      receivedAt: RECEIVED.toISOString(),
      mailSent: true,
    });
  });

  it("signed in: shows the exact end and mails the account address too", async () => {
    const { deps, mails } = fakeDeps();
    const receipt = await processCancellation(
      declaration({ email: "andere@example.com" }),
      {
        signedInUserId: "user-1",
        signedInEmail: "erika@example.com",
        networkHash: null,
      },
      deps,
    );
    expect(deps.userIdForEmail).not.toHaveBeenCalled();
    expect(receipt.outcome).toContain("20. November 2026");
    expect(mails[0]!.to).toEqual(["andere@example.com", "erika@example.com"]);
  });

  it("keeps an unknown address as unmatched and tells the operator", async () => {
    const { deps, updates, notes } = fakeDeps();
    const receipt = await processCancellation(
      declaration({ email: "fremd@example.com" }),
      anonymous,
      deps,
    );
    expect(deps.applyPlan).not.toHaveBeenCalled();
    expect(updates[0]).toMatchObject({ status: "unmatched", userId: null });
    expect(notes[0]!.title).toContain("von Hand zuordnen");
    expect(receipt.outcome).toContain("fremd@example.com");
  });

  it("does not touch Stripe for a subscription that already ends", async () => {
    const { deps, updates } = fakeDeps({
      subscriptionFor: vi.fn(async () => ({
        id: "sub_1",
        status: "active",
        periodEnd: PERIOD_END,
        cancelAtPeriodEnd: true,
      })),
    });
    await processCancellation(declaration(), anonymous, deps);
    expect(deps.applyPlan).not.toHaveBeenCalled();
    expect(updates[0]).toMatchObject({ status: "already_ending" });
  });

  it("treats an ended subscription as unmatched", async () => {
    const { deps, updates } = fakeDeps({
      subscriptionFor: vi.fn(async () => ({
        id: "sub_1",
        status: "canceled",
        periodEnd: PERIOD_END,
        cancelAtPeriodEnd: false,
      })),
    });
    await processCancellation(declaration(), anonymous, deps);
    expect(deps.applyPlan).not.toHaveBeenCalled();
    expect(updates[0]).toMatchObject({
      status: "unmatched",
      note: "Abo im Status canceled",
    });
  });

  it("still confirms receipt when Stripe fails, and flags it for the operator", async () => {
    const { deps, updates, notes, mails } = fakeDeps({
      applyPlan: vi.fn(async () => {
        throw new Error("stripe down");
      }),
    });
    const receipt = await processCancellation(declaration(), anonymous, deps);
    expect(updates[0]).toMatchObject({ status: "failed" });
    expect(notes[0]!.title).toContain("Stripe-Fehler");
    expect(mails).toHaveLength(1);
    expect(receipt.reference).toBe("K-20261029-TEST01");
  });

  it("schedules an extraordinary cancellation at the latest and marks it for review", async () => {
    const { deps, updates, mails } = fakeDeps();
    await processCancellation(
      declaration({ kind: "extraordinary", reason: "Wichtiger Grund" }),
      anonymous,
      deps,
    );
    expect(deps.applyPlan).toHaveBeenCalled();
    expect(updates[0]).toMatchObject({ status: "manual" });
    expect(mails[0]!.text).toContain("hilfsweise als ordentliche Kündigung");
  });

  it("ends a free account on receipt without looking for a subscription", async () => {
    const { deps, updates } = fakeDeps();
    const receipt = await processCancellation(
      declaration({ contract: "free" }),
      anonymous,
      deps,
    );
    expect(deps.subscriptionFor).not.toHaveBeenCalled();
    expect(updates[0]).toMatchObject({
      status: "manual",
      effectiveAt: RECEIVED,
    });
    expect(receipt.outcome).toContain("kostenloses Nutzungsverhältnis");
  });

  it("reports when no e-mail could be sent", async () => {
    const { deps, updates } = fakeDeps({
      sendMail: vi.fn(async () => ({ sent: false })),
    });
    const receipt = await processCancellation(declaration(), anonymous, deps);
    expect(receipt.mailSent).toBe(false);
    expect(updates).toHaveLength(1);
  });

  it("fails loudly when the declaration cannot be stored", async () => {
    const { deps } = fakeDeps({
      insert: vi.fn(async () => {
        throw new Error("db down");
      }),
    });
    await expect(
      processCancellation(declaration(), anonymous, deps),
    ).rejects.toThrow("db down");
    expect(deps.sendMail).not.toHaveBeenCalled();
  });
});
